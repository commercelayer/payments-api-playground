"use client";

import "@adyen/adyen-web/styles/adyen.css";
import type {
	AdyenCheckoutError,
	CheckoutAdvancedFlowResponse,
	CoreConfiguration,
	PaymentCompletedData,
	SubmitActions,
	SubmitData,
	UIElement,
} from "@adyen/adyen-web";
import type { Order } from "@commercelayer/sdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/create-client";
import * as ExpressOrder from "@/lib/express-order";
import { pollAndPlace, pollAuthorization } from "@/lib/payments";

// Apple Pay's error constructor is a browser global available when Apple Pay JS
// is present (Safari). Declared so we can flag unserviceable addresses.
declare const ApplePayError: {
	new (
		code: string,
		contactField?: string,
		message?: string,
	): ApplePayJS.ApplePayError;
};

type Props = {
	/** Sales-channel (guest) or customer access token. */
	accessToken: string;
	skuCode: string;
	/** Enabled Adyen payment setting. */
	adyenSettingId: string;
	/** Adyen client key (`public_key` on the setting). */
	adyenClientKey: string;
	/** SKU unit price — seeds the sheet before any order exists. */
	subtotalCents: number;
	/** ISO 4217 currency (e.g. "USD"). */
	currencyCode: string;
	/** ISO 3166 merchant country for Apple Pay — must match your Apple Pay
	 * merchant registration in the Adyen Customer Area. */
	countryCode: string;
	/** Display name shown in the Apple Pay sheet ("Pay <merchantName>"). Required
	 * in the advanced flow: with no session, adyen-web has no `configuration` to
	 * read `merchantName` from, so we must supply it. */
	merchantName: string;
	/** Apple Pay merchant identifier used for merchant validation. In the Sessions
	 * flow this comes from the session `/setup`; the advanced flow has no session,
	 * so we must pass it or Adyen's `/applePay/sessions` fails with
	 * "Required field 'merchantIdentifier' is null" (error 702). For Adyen's
	 * managed certificate this is Adyen's Apple merchant id; grab the exact value
	 * from the `merchantIdentifier` in the working Sessions-flow validation request
	 * (Network tab) or from your Adyen Apple Pay settings. */
	merchantId: string;
	/** True when the visitor is already logged in as a customer. */
	isCustomer: boolean;
	/** When false (digital do_not_ship), the sheet collects no shipping address
	 * and no shipping callbacks run — order is created only at authorization. */
	requireShipping?: boolean;
};

type Status = "loading" | "ready" | "unavailable" | "processing" | "error";

const toAppleAmount = (cents: number): string => (cents / 100).toFixed(2);

const appleTotal = (
	cents: number,
	label = "Total",
): ApplePayJS.ApplePayLineItem => ({
	label,
	amount: toAppleAmount(cents),
	type: "final",
});

/** Map CL's available shipping methods (first shipment) to Apple Pay's shape. */
function mapApplePayShippingMethods(
	order: Order,
): ApplePayJS.ApplePayShippingMethod[] {
	const methods = order.shipments?.[0]?.available_shipping_methods ?? [];
	return methods.map((m) => ({
		label: m.name ?? "Shipping",
		detail: m.reference ?? "",
		amount: toAppleAmount(
			m.price_amount_for_shipment_cents ?? m.price_amount_cents ?? 0,
		),
		identifier: m.id,
	}));
}

/**
 * AdyenExpressAdvanced — product-page Apple Pay express via Adyen's **Advanced
 * flow** (adyen-web v6). Unlike the Sessions-flow button, this renders from just
 * `clientKey` + `amount` with **no session and no order created up front**:
 *
 *  - Physical goods: the CL order is created lazily in the first
 *    `onShippingContactSelected`, then recomputed (shipping + tax) on every
 *    address/method change; the Apple Pay sheet total is driven by `newTotal`.
 *  - Digital (`requireShipping=false`): no shipping callbacks — the order is
 *    created only at authorization.
 *
 * This is the true analog of the Stripe Express Checkout deferral, and it makes
 * the amount fully dynamic (the final total goes to Adyen `/payments` at
 * `onSubmit`, not a pre-baked session amount).
 *
 * Advanced-flow relay (per the CL API team): we create the `payment_session`
 * but IGNORE its `sessionData`; the wallet payload rides in `client_data` (the
 * analog of the old `adyen_payments.payment_request_data`), and creating a
 * `payment_authorization` triggers CL → Adyen `/payments`. That relay is
 * asynchronous, so we poll the authorization until it leaves `pending`
 * (`pollAuthorization`). A `requires_action`/`action` result is a 3DS challenge
 * handled in `onAdditionalDetails` — rare for Apple Pay, where on-device
 * biometric CVM + network tokenization usually satisfies SCA.
 */
export function AdyenExpressAdvanced(props: Props) {
	const router = useRouter();
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<Status>("loading");
	const [error, setError] = useState<string | null>(null);

	const orderIdRef = useRef<string | null>(null);
	const addressIdRef = useRef<string | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const contactRef = useRef<{
		billing?: ApplePayJS.ApplePayPaymentContact;
		shipping?: ApplePayJS.ApplePayPaymentContact;
		email?: string;
		phone?: string;
	} | null>(null);
	const componentRef = useRef<UIElement | null>(null);

	const requireShipping = props.requireShipping !== false;

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount once; all inputs are stable props
	useEffect(() => {
		let cancelled = false;
		const client = createClient(props.accessToken);
		let checkout: Awaited<
			ReturnType<typeof import("@adyen/adyen-web").AdyenCheckout>
		> | null = null;

		/** Write/refresh the redacted shipping address and recompute the order. */
		async function recomputeForContact(
			contact: ApplePayJS.ApplePayPaymentContact,
		): Promise<Order> {
			const orderId = await ExpressOrder.ensureExpressOrder(
				client,
				props.skuCode,
				orderIdRef.current,
			);
			orderIdRef.current = orderId;
			addressIdRef.current = await ExpressOrder.applyRedactedAddress(
				client,
				orderId,
				addressIdRef.current,
				{
					country: contact.countryCode,
					state: contact.administrativeArea,
					city: contact.locality,
					postal_code: contact.postalCode,
				},
			);
			let order = await ExpressOrder.recalcOrder(client, orderId);
			await ExpressOrder.ensureShippingMethods(client, order);
			order = await ExpressOrder.recalcOrder(client, orderId);
			return order;
		}

		async function onShippingContactSelected(
			resolve: (u: ApplePayJS.ApplePayShippingContactUpdate) => void,
			reject: (u: ApplePayJS.ApplePayShippingContactUpdate) => void,
			event: ApplePayJS.ApplePayShippingContactSelectedEvent,
		) {
			try {
				const order = await recomputeForContact(event.shippingContact);
				const methods = mapApplePayShippingMethods(order);
				const { totalCents } = ExpressOrder.expressAmounts(order);
				if (methods.length === 0) {
					// No CL method serves this address — flag it unserviceable.
					resolve({
						newTotal: appleTotal(totalCents),
						errors: [
							new ApplePayError(
								"shippingContactInvalid",
								"postalAddress",
								"We can't ship to this address.",
							),
						],
					});
					return;
				}
				checkout?.update({
					amount: { value: totalCents, currency: props.currencyCode },
				});
				resolve({
					newTotal: appleTotal(totalCents),
					newShippingMethods: methods,
				});
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("[adyen-express] shipping contact change failed:", e);
				reject({ newTotal: appleTotal(props.subtotalCents) });
			}
		}

		async function onShippingMethodSelected(
			resolve: (u: ApplePayJS.ApplePayShippingMethodUpdate) => void,
			reject: (u: ApplePayJS.ApplePayShippingMethodUpdate) => void,
			event: ApplePayJS.ApplePayShippingMethodSelectedEvent,
		) {
			try {
				const orderId = orderIdRef.current;
				if (!orderId) {
					reject({ newTotal: appleTotal(props.subtotalCents) });
					return;
				}
				let order = await ExpressOrder.recalcOrder(client, orderId);
				await ExpressOrder.selectShippingMethod(
					client,
					order,
					event.shippingMethod.identifier,
				);
				order = await ExpressOrder.recalcOrder(client, orderId);
				const { totalCents } = ExpressOrder.expressAmounts(order);
				checkout?.update({
					amount: { value: totalCents, currency: props.currencyCode },
				});
				resolve({ newTotal: appleTotal(totalCents) });
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("[adyen-express] shipping method change failed:", e);
				reject({ newTotal: appleTotal(props.subtotalCents) });
			}
		}

		/** Overwrite the redacted placeholders with the real, non-redacted details
		 * now revealed at authorization. */
		async function finalizeOrder(orderId: string): Promise<void> {
			const c = contactRef.current;
			if (!c) return;

			const b = c.billing;
			if (b?.countryCode) {
				const address = await client.addresses.create({
					first_name: b.givenName || "Express",
					last_name: b.familyName || "Checkout",
					line_1: b.addressLines?.[0] || "N/A",
					line_2: b.addressLines?.[1] || undefined,
					city: b.locality || "—",
					state_code: b.administrativeArea || b.locality || b.countryCode,
					zip_code: b.postalCode || "—",
					country_code: b.countryCode,
					phone: c.phone || "0000000000",
				});
				await client.orders.update({
					id: orderId,
					billing_address: client.addresses.relationship(address.id),
				});
			}

			const s = c.shipping;
			if (requireShipping && addressIdRef.current && s?.countryCode) {
				await client.addresses.update({
					id: addressIdRef.current,
					first_name: s.givenName || "Express",
					last_name: s.familyName || "Checkout",
					line_1: s.addressLines?.[0] || "N/A",
					line_2: s.addressLines?.[1] || undefined,
					city: s.locality || "—",
					state_code: s.administrativeArea || s.locality || s.countryCode,
					zip_code: s.postalCode || "—",
					country_code: s.countryCode,
					phone: c.phone || "0000000000",
				});
			}

			if (!props.isCustomer && c.email) {
				await client.orders.update({
					id: orderId,
					customer_email: c.email,
				});
			}
		}

		/** Build the advanced-flow payload from adyen-web's `state.data`, mirroring
		 * the old `adyen_payments` `payment_request_data`. */
		function buildClientData(state: SubmitData): Record<string, unknown> {
			const stateData = state.data as unknown as Record<string, unknown> & {
				paymentMethod?: unknown;
			};
			const clientData: Record<string, unknown> = {
				...stateData,
				payment_method: stateData.paymentMethod,
				return_url: window.location.href,
				origin: window.location.origin,
				redirect_from_issuer_method: "GET",
				shopperInteraction: "Ecommerce",
			};
			delete clientData.paymentMethod;
			return clientData;
		}

		const readResultCode = (auth: {
			response_data?: Record<string, unknown> | null;
		}): string | undefined =>
			typeof auth.response_data?.resultCode === "string"
				? (auth.response_data.resultCode as string)
				: undefined;

		/** Succeeded per CL's own status, or per an accepting Adyen resultCode when
		 * `response_data` is readable (integration token). */
		const isExpressAuthSuccess = (auth: {
			status: string;
			response_data?: Record<string, unknown> | null;
		}): boolean => {
			if (auth.status === "succeeded") return true;
			const resultCode = readResultCode(auth);
			return (
				resultCode != null && ["Authorised", "Received"].includes(resultCode)
			);
		};

		/** Adyen action for `createFromAction`. Prefer CL's `next_action_data`
		 * projection: `response_data` is not served to sales-channel/customer tokens,
		 * so in the browser it is always undefined. Gate on `next_action_type` —
		 * `next_action_data` is `{}`, not null, when there is nothing to do. */
		const readAction = (auth: {
			response_data?: Record<string, unknown> | null;
			next_action_type?: string | null;
			next_action_data?: Record<string, unknown> | null;
		}): Record<string, unknown> | null => {
			const action = auth.next_action_type
				? auth.next_action_data
				: auth.response_data?.action;
			return action != null &&
				typeof action === "object" &&
				typeof (action as { type?: unknown }).type === "string"
				? (action as Record<string, unknown>)
				: null;
		};

		async function handleSubmit(state: SubmitData, actions: SubmitActions) {
			try {
				setStatus("processing");
				// Digital path: no shipping callback ran, so create the order now.
				const orderId = await ExpressOrder.ensureExpressOrder(
					client,
					props.skuCode,
					orderIdRef.current,
				);
				orderIdRef.current = orderId;
				await finalizeOrder(orderId);

				// Final amount = the live order total (advanced flow authorizes what
				// we send to /payments, not a pre-baked session amount).
				const order = await ExpressOrder.recalcOrder(client, orderId);
				const amountCents =
					order.total_amount_with_taxes_cents ??
					order.total_amount_cents ??
					props.subtotalCents;

				// Advanced flow: we IGNORE the session's sessionData and drive Adyen
				// /payments ourselves (mirrors the old adyen_payments relay). The wallet
				// payload rides in `client_data`; creating the payment_authorization is
				// what triggers CL → Adyen /payments.
				const session = await client.payment_sessions.create({
					amount_cents: amountCents,
					client_data: buildClientData(state),
					payment_setting: client.payment_settings.relationship(
						props.adyenSettingId,
					),
					order: client.orders.relationship(orderId),
				});
				sessionIdRef.current = session.id;

				// The authorization relays /payments asynchronously → poll until it
				// leaves `pending`.
				const created = await client.payment_authorizations.create({
					payment_session: client.payment_sessions.relationship(session.id),
				});
				const auth = await pollAuthorization(client, created.id);
				const resultCode = readResultCode(auth);
				const action = readAction(auth);

				if (auth.status === "requires_action" || action != null) {
					// 3DS challenge — uncommon for Apple Pay (on-device auth usually
					// satisfies SCA). Hand the action back to the component; it will
					// collect the details and fire onAdditionalDetails.
					actions.resolve({
						resultCode: (resultCode ??
							"Pending") as CheckoutAdvancedFlowResponse["resultCode"],
						action: action as unknown as CheckoutAdvancedFlowResponse["action"],
					});
					return;
				}

				if (
					auth.status === "succeeded" ||
					(resultCode != null &&
						["Authorised", "Received"].includes(resultCode))
				) {
					// Success → let adyen-web close the sheet; we place the order in
					// onPaymentCompleted.
					actions.resolve({
						resultCode: (resultCode ??
							"Authorised") as CheckoutAdvancedFlowResponse["resultCode"],
					});
					return;
				}

				const reason =
					(auth.response_data?.refusalReason as string | undefined) ??
					`Payment ${auth.status}`;
				setError(reason);
				setStatus("error");
				actions.reject();
			} catch (e) {
				setError(e instanceof Error ? e.message : "Payment failed.");
				setStatus("error");
				actions.reject();
			}
		}

		async function handleAdditionalDetails(
			// biome-ignore lint/suspicious/noExplicitAny: adyen additional-details state
			state: any,
			// biome-ignore lint/suspicious/noExplicitAny: adyen additional-details actions
			actions: any,
		) {
			// 3DS follow-up (rare for Apple Pay). The details go to the
			// authorization's `_payment_details` trigger, which CL relays to Adyen
			// /payments/details. The session's `_additional_data` trigger looks
			// similar but goes to /paymentMethods, so the result would never reach
			// the payment. CL forwards the body verbatim, hence the full state.data:
			// without its `paymentData` Adyen cannot match the details to the
			// payment and answers 422.
			try {
				const sessionId = sessionIdRef.current;
				if (!sessionId)
					throw new Error("Missing session for additional details.");
				const session = await client.payment_sessions.retrieve(sessionId, {
					include: ["payment_authorization"],
				});
				const authId = session.payment_authorization?.id;
				if (!authId)
					throw new Error("No authorization to submit 3DS details to.");
				await client.payment_authorizations._payment_details(
					authId,
					(state?.data ?? {}) as Record<string, unknown>,
				);
				// Poll through `requires_action` too: that is the status right now, and
				// reading it back before it clears returns the action just satisfied.
				const finalAuth = await pollAuthorization(client, authId, {
					transientStatuses: ["pending", "requires_action"],
					maxAttempts: 10,
				});
				// Only while the authorization still waits for one: `next_action_data`
				// keeps the action just satisfied after the status has moved on, and
				// rendering it would start the same challenge over.
				const followUp =
					finalAuth.status === "requires_action" ? readAction(finalAuth) : null;
				if (followUp) {
					actions.resolve?.({
						resultCode: readResultCode(finalAuth) ?? "Pending",
						action: followUp,
					});
					return;
				}
				// Decide on `status`, never on a defaulted resultCode: `response_data` is
				// withheld from customer tokens, so readResultCode is always undefined in
				// the browser and `resultCode ?? "Authorised"` would report success on a
				// failed authentication.
				if (!isExpressAuthSuccess(finalAuth)) {
					throw new Error(`Payment ${finalAuth.status}.`);
				}
				actions.resolve?.({
					resultCode: readResultCode(finalAuth) ?? "Authorised",
				});
			} catch (e) {
				setError(e instanceof Error ? e.message : "3-D Secure failed.");
				setStatus("error");
				actions.reject?.();
			}
		}

		async function handleCompleted() {
			// The authorization already succeeded in handleSubmit — just place it.
			const orderId = orderIdRef.current;
			if (!orderId) {
				setError("Missing order after authorization.");
				setStatus("error");
				return;
			}
			try {
				await pollAndPlace(client, orderId);
				router.push(`/orders/${orderId}`);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Could not place the order.");
				setStatus("error");
			}
		}

		(async () => {
			try {
				const { AdyenCheckout, ApplePay } = await import("@adyen/adyen-web");
				if (cancelled || !containerRef.current) return;

				const config: CoreConfiguration = {
					environment: props.adyenClientKey.startsWith("live_")
						? "live"
						: "test",
					clientKey: props.adyenClientKey,
					// Advanced flow: NO session. Amount seeds the sheet; onSubmit relays.
					amount: { value: props.subtotalCents, currency: props.currencyCode },
					countryCode: props.countryCode,
					onSubmit: (state, _component, actions) => {
						void handleSubmit(state, actions);
					},
					onAdditionalDetails: (state, _component, actions) => {
						handleAdditionalDetails(state, actions);
					},
					onPaymentCompleted: (_data: PaymentCompletedData) => {
						void handleCompleted();
					},
					onPaymentFailed: (data) => {
						const resultCode =
							data && "resultCode" in data ? data.resultCode : undefined;
						setError(`Payment ${resultCode?.toLowerCase() ?? "failed"}`);
						setStatus("error");
					},
					onError: (err: AdyenCheckoutError) => {
						setError(err.message ?? "Payment failed");
						setStatus("error");
					},
				};

				checkout = await AdyenCheckout(config);
				const applepay = new ApplePay(checkout, {
					isExpress: true,
					expressPage: "pdp",
					// Advanced flow has no session, so supply the Apple Pay config
					// ourselves: merchantName (else the component reads it off
					// undefined and throws on click) and merchantId (else Adyen's
					// merchant validation fails with "merchantIdentifier is null").
					configuration: {
						merchantId: props.merchantId,
						merchantName: props.merchantName,
					},
					requiredBillingContactFields: ["postalAddress"],
					requiredShippingContactFields: requireShipping
						? ["postalAddress", "name", "phoneticName", "phone", "email"]
						: ["name", "phone", "email"],
					...(requireShipping
						? { onShippingContactSelected, onShippingMethodSelected }
						: {}),
					onAuthorized: (data, actions) => {
						const payment = data.authorizedEvent?.payment;
						contactRef.current = {
							billing: payment?.billingContact,
							shipping: payment?.shippingContact,
							email: payment?.shippingContact?.emailAddress,
							phone: payment?.shippingContact?.phoneNumber,
						};
						actions.resolve();
					},
				});

				const available = await applepay
					.isAvailable()
					.then(() => true)
					.catch(() => false);
				if (cancelled || !containerRef.current) return;
				if (!available) {
					setStatus("unavailable");
					return;
				}
				applepay.mount(containerRef.current);
				componentRef.current = applepay;
				setStatus("ready");
			} catch (e) {
				if (!cancelled) {
					setError(
						e instanceof Error ? e.message : "Could not initialize Apple Pay.",
					);
					setStatus("error");
				}
			}
		})();

		return () => {
			cancelled = true;
			componentRef.current?.unmount();
			componentRef.current = null;
		};
	}, []);

	return (
		<div className="flex flex-col gap-2">
			<div ref={containerRef} className="adyen-express-container" />
			{status === "loading" && (
				<p className="text-xs text-gray-400">Loading Apple Pay…</p>
			)}
			{status === "processing" && (
				<p className="text-xs text-gray-500">Completing your order…</p>
			)}
			{status === "unavailable" && (
				<p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
					Apple Pay isn't available in this browser. It requires Safari
					(macOS/iOS) with a card in Wallet, and the exact domain registered in
					your Adyen Customer Area for this merchant account/mode.
				</p>
			)}
			{error && <p className="text-xs text-red-500">{error}</p>}
		</div>
	);
}
