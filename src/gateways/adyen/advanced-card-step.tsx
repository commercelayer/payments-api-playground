"use client";

import "@adyen/adyen-web/styles/adyen.css";
import type {
	AdyenCheckoutError,
	CoreConfiguration,
	PaymentCompletedData,
	SubmitActions,
	SubmitData,
	UIElement,
} from "@adyen/adyen-web";
import { useEffect, useRef } from "react";
import {
	authorizeAdyenAdvanced,
	getOrderCountryCode,
	submitAdyenAdvancedDetails,
} from "./actions";

/**
 * Advanced-flow card entry for checkout — the saveable counterpart to the
 * Sessions-flow Drop-in. On the Drop-in CL always asks the shopper for consent
 * to store the card, so the shopper can untick it; this flow can store the
 * card unconditionally, which a recurring order needs.
 *
 * A standalone Card is mounted with NO session (just clientKey + amount). The
 * entered card returns via `onSubmit`; from there ALL CL/Adyen orchestration runs
 * in server actions (`actions.ts`) under the integration token. That's
 * required because a `succeeded` payment_authorization's response_data is not
 * served to sales-channel/customer tokens (401), so the browser can neither poll
 * it to completion nor read the reusable token. The component only drives the
 * adyen-web UI and relays state.data to the server.
 */
export function AdyenAdvancedCardStep({
	orderId,
	settingId,
	clientKey,
	amountCents,
	currencyCode,
	customerId,
	mustSaveCard,
	onAuthorized,
	onError,
}: {
	orderId: string;
	settingId: string;
	clientKey: string;
	amountCents: number;
	currencyCode: string;
	/** Enables the "save card" checkbox + store fields when a customer is logged in. */
	customerId: string | null;
	/** Stores the card without asking. On a recurring order the subscription has
	 * nothing to charge otherwise, so the checkbox is not offered at all. */
	mustSaveCard: boolean;
	/** Called with the created session id once the authorization succeeds. */
	onAuthorized: (sessionId: string) => void;
	onError: (message: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const sessionIdRef = useRef<string | null>(null);
	/** Serialized 3DS actions already handed to the component, so an unchanged
	 * action coming back from CL is reported instead of replayed. */
	const handledActionsRef = useRef<Set<string>>(new Set());

	const onAuthorizedRef = useRef(onAuthorized);
	const onErrorRef = useRef(onError);
	onAuthorizedRef.current = onAuthorized;
	onErrorRef.current = onError;

	useEffect(() => {
		if (!containerRef.current) return;
		let component: UIElement | null = null;
		let cancelled = false;

		/** Card payload for Adyen /payments (relayed via the session client_data).
		 * Only standard adyen-web state.data fields survive CL's client_data
		 * forwarding; store context (shopperReference/recurringProcessingModel) is
		 * added by CL from the session's `vaulting` flag. */
		function buildClientData(state: SubmitData): Record<string, unknown> {
			const stateData = state.data as unknown as Record<string, unknown> & {
				paymentMethod?: unknown;
			};
			const clientData: Record<string, unknown> = {
				...stateData, // paymentMethod, storePaymentMethod (checkbox), browserInfo
				payment_method: stateData.paymentMethod,
				// CL reads snake_case client_data[:browser_info]; adyen-web emits
				// camelCase browserInfo. Map it, else Adyen 15_002 ("browserInfo missing
				// for device channel browser") once native 3DS2 is signalled.
				browser_info: stateData.browserInfo,
				return_url: window.location.href,
				origin: window.location.origin,
			};
			delete clientData.paymentMethod;
			return clientData;
		}

		async function handleSubmit(state: SubmitData, actions: SubmitActions) {
			try {
				const storing =
					(mustSaveCard ||
						Boolean(
							(state.data as unknown as { storePaymentMethod?: boolean })
								.storePaymentMethod,
						)) &&
					!!customerId;

				const result = await authorizeAdyenAdvanced({
					orderId,
					settingId,
					amountCents,
					clientData: buildClientData(state),
					storing,
					customerId,
				});
				sessionIdRef.current = result.sessionId || null;

				if (result.error) {
					onErrorRef.current(result.error);
					actions.reject();
					return;
				}

				if (result.action != null) {
					// 3DS — hand back to the component; it fires onAdditionalDetails.
					handledActionsRef.current.add(JSON.stringify(result.action));
					actions.resolve({
						resultCode: (result.resultCode ?? "Pending") as never,
						action: result.action as never,
					});
					return;
				}

				// Success → onPaymentCompleted fires next and calls onAuthorized.
				actions.resolve({
					resultCode: (result.resultCode ?? "Authorised") as never,
				});
			} catch (e) {
				onErrorRef.current(e instanceof Error ? e.message : "Payment failed.");
				actions.reject();
			}
		}

		async function handleAdditionalDetails(
			// biome-ignore lint/suspicious/noExplicitAny: adyen additional-details state
			state: any,
			// biome-ignore lint/suspicious/noExplicitAny: adyen additional-details actions
			actions: any,
		) {
			try {
				const sessionId = sessionIdRef.current;
				if (!sessionId)
					throw new Error("Missing session for additional details.");
				// Pass the FULL state.data ({ details, paymentData }) — paymentData links
				// the details to the original transaction at Adyen /payments/details.
				const result = await submitAdyenAdvancedDetails({
					sessionId,
					stateData: state?.data,
				});
				if (result.error) {
					onErrorRef.current(result.error);
					actions.reject?.();
					return;
				}
				if (result.action != null) {
					// Native 3DS2 next step (e.g. fingerprint → challenge): hand the new
					// action back so the component renders it and fires
					// onAdditionalDetails again for the following round. Never hand back
					// an action we already handled: replaying a threeDS2 fingerprint makes
					// adyen-web POST submitThreeDS2Fingerprint with an already-used token,
					// which Adyen answers 500 `14_0401`.
					const fingerprint = JSON.stringify(result.action);
					if (handledActionsRef.current.has(fingerprint)) {
						onErrorRef.current(
							"3-D Secure did not advance: Commerce Layer returned the same action twice.",
						);
						actions.reject?.();
						return;
					}
					handledActionsRef.current.add(fingerprint);
					actions.resolve?.({
						resultCode: result.resultCode ?? "Pending",
						action: result.action,
					});
					return;
				}
				// Strict: the server already confirmed success and set resultCode. Never
				// default to "Authorised" here — reject if it's somehow missing.
				if (!result.resultCode) {
					onErrorRef.current("Missing result from 3-D Secure.");
					actions.reject?.();
					return;
				}
				actions.resolve?.({ resultCode: result.resultCode });
			} catch (e) {
				onErrorRef.current(
					e instanceof Error ? e.message : "3-D Secure failed.",
				);
				actions.reject?.();
			}
		}

		(async () => {
			// Advanced flow has no session to read the shopper country from; adyen-web
			// throws without a countryCode. Derive it from the order (server-side).
			const countryCode = await getOrderCountryCode(orderId);
			if (cancelled || !containerRef.current) return;
			if (!countryCode) {
				onErrorRef.current("Order has no country code to initialise checkout.");
				return;
			}

			const { AdyenCheckout, Card } = await import("@adyen/adyen-web");
			if (cancelled || !containerRef.current) return;

			const config: CoreConfiguration = {
				environment: clientKey.startsWith("live_") ? "live" : "test",
				clientKey,
				countryCode,
				amount: { value: amountCents, currency: currencyCode },
				onSubmit: (state, _component, actions) => {
					void handleSubmit(state, actions);
				},
				onAdditionalDetails: (state, _component, actions) => {
					void handleAdditionalDetails(state, actions);
				},
				onPaymentCompleted: (_data: PaymentCompletedData) => {
					if (sessionIdRef.current)
						onAuthorizedRef.current(sessionIdRef.current);
				},
				onPaymentFailed: (data) => {
					const resultCode =
						data && "resultCode" in data ? data.resultCode : undefined;
					onErrorRef.current(
						`Payment ${resultCode?.toLowerCase() ?? "failed"}`,
					);
				},
				onError: (error: AdyenCheckoutError) => {
					onErrorRef.current(error.message ?? "Payment failed");
				},
			};

			const checkout = await AdyenCheckout(config);
			if (cancelled || !containerRef.current) {
				checkout.remove(checkout as never);
				return;
			}
			// enableStoreDetails renders the native "save card" checkbox; the choice
			// returns as state.data.storePaymentMethod. Left out when saving is
			// mandatory, since unticking it would change nothing.
			component = new Card(checkout, {
				enableStoreDetails: !!customerId && !mustSaveCard,
			}) as unknown as UIElement;
			component.mount(containerRef.current);
		})();

		return () => {
			cancelled = true;
			component?.unmount();
		};
	}, [
		orderId,
		settingId,
		clientKey,
		amountCents,
		currencyCode,
		customerId,
		mustSaveCard,
	]);

	return <div ref={containerRef} className="adyen-advanced-card-container" />;
}
