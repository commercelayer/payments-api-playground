"use client";

import {
	Elements,
	ExpressCheckoutElement,
	useElements,
	useStripe,
} from "@stripe/react-stripe-js";
import {
	loadStripe,
	type StripeElementsOptions,
	type StripeExpressCheckoutElementConfirmEvent,
	type StripeExpressCheckoutElementOptions,
	type StripeExpressCheckoutElementReadyEvent,
	type StripeExpressCheckoutElementShippingAddressChangeEvent,
	type StripeExpressCheckoutElementShippingRateChangeEvent,
} from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/create-client";
import * as ExpressOrder from "@/lib/express-order";
import { pollAndPlace } from "@/lib/payments";

type Props = {
	/** Sales-channel (guest) or customer access token. */
	accessToken: string;
	skuCode: string;
	/** Enabled Stripe payment setting. */
	stripeSettingId: string;
	stripePublishableKey: string;
	/** SKU unit price — seeds the wallet button before any address exists. */
	subtotalCents: number;
	/** ISO currency (e.g. "EUR"). */
	currencyCode: string;
	/** True when the visitor is already logged in as a customer. */
	isCustomer: boolean;
	/** When false (e.g. a digital do_not_ship SKU), the sheet collects no shipping
	 * address. This avoids CL setting `shipping` on the PaymentIntent, which is
	 * the Gap-5 blocker for physical goods. */
	requireShipping?: boolean;
};

function eceOptions(
	requireShipping: boolean,
): StripeExpressCheckoutElementOptions {
	return {
		buttonType: { applePay: "buy", googlePay: "buy" },
		billingAddressRequired: true,
		emailRequired: true,
		shippingAddressRequired: requireShipping,
		// A placeholder rate so the sheet opens with shipping enabled; replaced by
		// real CL methods in onShippingAddressChange.
		...(requireShipping
			? {
					shippingRates: [
						{
							id: "pending",
							displayName: "Calculated at next step",
							amount: 0,
						},
					],
				}
			: {}),
	};
}

/**
 * ExpressInner — owns the whole wallet lifecycle. Lives inside <Elements> so it
 * can use the Stripe hooks. Creates the CL order lazily inside the first
 * shipping callback, recomputes shipping + tax against CL on every change, and
 * creates the payment_session only at confirm (when the amount is final).
 */
function ExpressInner(props: Props) {
	const stripe = useStripe();
	const elements = useElements();
	const router = useRouter();
	const client = useMemo(
		() => createClient(props.accessToken),
		[props.accessToken],
	);

	const orderIdRef = useRef<string | null>(null);
	const addressIdRef = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [wallets, setWallets] = useState<string[] | null>(null);

	function onReady(event: StripeExpressCheckoutElementReadyEvent) {
		const available = event.availablePaymentMethods;
		const names = available
			? Object.entries(available)
					.filter(([, v]) => v)
					.map(([k]) => k)
			: [];
		setWallets(names);
		// Diagnostic — inspect in the browser console while testing.
		console.log("[express-checkout] available wallets:", available);
	}

	async function onShippingAddressChange(
		event: StripeExpressCheckoutElementShippingAddressChangeEvent,
	) {
		try {
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
				event.address,
			);

			let order = await ExpressOrder.recalcOrder(client, orderId);
			await ExpressOrder.ensureShippingMethods(client, order);
			order = await ExpressOrder.recalcOrder(client, orderId);

			const shippingRates = ExpressOrder.mapShippingRates(order);
			if (shippingRates.length === 0) {
				// No CL shipping method covers this address (shipping-zone mismatch,
				// e.g. shipping to a country the market's methods don't serve).
				// eslint-disable-next-line no-console
				console.warn(
					"[express-checkout] no available shipping methods for",
					event.address,
					"— address rejected as unserviceable.",
				);
				event.reject();
				return;
			}
			const { totalCents } = ExpressOrder.expressAmounts(order);
			elements?.update({ amount: totalCents });
			event.resolve({ shippingRates });
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[express-checkout] shipping address change failed:", e);
			setError(
				e instanceof Error ? e.message : "Could not price this address.",
			);
			event.reject();
		}
	}

	async function onShippingRateChange(
		event: StripeExpressCheckoutElementShippingRateChangeEvent,
	) {
		try {
			const orderId = orderIdRef.current;
			if (!orderId) {
				event.reject();
				return;
			}
			let order = await ExpressOrder.recalcOrder(client, orderId);
			await ExpressOrder.selectShippingMethod(
				client,
				order,
				event.shippingRate.id,
			);
			order = await ExpressOrder.recalcOrder(client, orderId);

			const { totalCents } = ExpressOrder.expressAmounts(order);
			elements?.update({ amount: totalCents });
			event.resolve({ shippingRates: ExpressOrder.mapShippingRates(order) });
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[express-checkout] shipping rate change failed:", e);
			setError(e instanceof Error ? e.message : "Could not update shipping.");
			event.reject();
		}
	}

	async function onConfirm(event: StripeExpressCheckoutElementConfirmEvent) {
		if (!stripe || !elements) {
			event.paymentFailed({ reason: "fail" });
			return;
		}
		try {
			// Elements must be submitted before creating/confirming the intent.
			const { error: submitError } = await elements.submit();
			if (submitError)
				throw new Error(submitError.message ?? "Validation failed.");

			// In no-shipping mode there was no shipping callback, so the order may
			// not exist yet — create it now.
			const orderId = await ExpressOrder.ensureExpressOrder(
				client,
				props.skuCode,
				orderIdRef.current,
			);
			orderIdRef.current = orderId;

			// Full address + email are now available — overwrite the placeholders.
			// Shipping is skipped when the SKU doesn't require it (no address record).
			await ExpressOrder.finalizeExpressOrder(
				client,
				orderId,
				addressIdRef.current,
				{
					shipping:
						props.requireShipping === false ? undefined : event.shippingAddress,
					billing: event.billingDetails,
					setEmail: !props.isCustomer,
				},
			);

			// Amount is final — create the CL payment session (immutable amount).
			const order = await ExpressOrder.recalcOrder(client, orderId);
			const amountCents =
				order.total_amount_with_taxes_cents ?? order.total_amount_cents ?? 0;
			const session = await client.payment_sessions.create({
				amount_cents: amountCents,
				payment_setting: client.payment_settings.relationship(
					props.stripeSettingId,
				),
				order: client.orders.relationship(orderId),
			});

			const clientSecret =
				typeof session.response_data?.client_secret === "string"
					? session.response_data.client_secret
					: null;
			if (!clientSecret)
				throw new Error("Payment session did not return a client secret.");

			const { error: confirmError } = await stripe.confirmPayment({
				elements,
				clientSecret,
				confirmParams: {
					return_url: `${window.location.origin}/orders/${orderId}`,
				},
				redirect: "if_required",
			});
			if (confirmError)
				throw new Error(confirmError.message ?? "Payment failed.");

			await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
			});
			await pollAndPlace(client, orderId);
			router.push(`/orders/${orderId}`);
		} catch (e) {
			event.paymentFailed({ reason: "fail" });
			setError(e instanceof Error ? e.message : "Express payment failed.");
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<ExpressCheckoutElement
				options={eceOptions(props.requireShipping !== false)}
				onReady={onReady}
				onConfirm={onConfirm}
				{...(props.requireShipping === false
					? {}
					: {
							onShippingAddressChange,
							onShippingRateChange,
						})}
			/>
			{wallets != null && wallets.length === 0 && (
				<p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
					No express wallet available in this browser. Apple Pay requires Safari
					(macOS/iOS) with a card in Wallet, and the exact domain registered in
					your Stripe dashboard for this account/mode. Check the console for
					details.
				</p>
			)}
			{error && <p className="text-xs text-red-500">{error}</p>}
		</div>
	);
}

/**
 * ExpressCheckout — product-page wallet button (Apple Pay / Google Pay) backed
 * by the new CL payments API. Uses a deferred Elements instance seeded with the
 * SKU subtotal; the real total is computed by CL inside the sheet callbacks.
 */
export function ExpressCheckout(props: Props) {
	const stripePromise = useMemo(
		() => loadStripe(props.stripePublishableKey),
		[props.stripePublishableKey],
	);

	const options: StripeElementsOptions = {
		mode: "payment",
		amount: props.subtotalCents,
		currency: props.currencyCode.toLowerCase(),
		// Must match the PaymentIntent CL creates: the new payments flow authorizes
		// then captures separately, so the intent uses manual capture.
		captureMethod: "manual",
	};

	return (
		<Elements stripe={stripePromise} options={options}>
			<ExpressInner {...props} />
		</Elements>
	);
}
