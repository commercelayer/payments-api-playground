"use client";

import "@adyen/adyen-web/styles/adyen.css";
import type { AdyenCheckoutError, UIElement } from "@adyen/adyen-web";
import { useEffect, useRef } from "react";
import { getOrderCountryCode } from "./actions";

/**
 * Renders an Adyen 3DS (or other) action returned when reusing a saved card.
 *
 * The saved-card reuse path drives Adyen /payments through CL's advanced flow
 * (no Drop-in), so a returned `action` has no component to handle it. We mount a
 * bare adyen-web instance and hand the action to `createFromAction`; when the
 * challenge completes, `onAdditionalDetails` fires and the caller relays the
 * details to CL via `payment_authorizations._payment_details` (the session's
 * `_additional_data` trigger goes to Adyen /paymentMethods — wrong endpoint).
 * The action itself comes from CL's `next_action_data`, the only form readable
 * with a sales-channel/customer token.
 */
export function AdyenActionStep({
	action,
	clientKey,
	orderId,
	onDetails,
	onError,
}: {
	action: Record<string, unknown>;
	clientKey: string;
	orderId: string;
	/** Full adyen-web `state.data` ({ details, paymentData }) — the caller forwards
	 * it to CL /payments/details; paymentData links it to the original transaction. */
	onDetails: (stateData: unknown) => void;
	onError: (message: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onDetailsRef = useRef(onDetails);
	const onErrorRef = useRef(onError);
	onDetailsRef.current = onDetails;
	onErrorRef.current = onError;

	useEffect(() => {
		if (!containerRef.current) return;
		let component: UIElement | null = null;
		let cancelled = false;

		(async () => {
			// Advanced flow has no session to read the shopper country from; adyen-web
			// throws without a countryCode. Derive it from the order (server-side).
			const countryCode = await getOrderCountryCode(orderId);
			if (cancelled || !containerRef.current) return;
			if (!countryCode) {
				onErrorRef.current("Order has no country code to initialise checkout.");
				return;
			}

			const { AdyenCheckout } = await import("@adyen/adyen-web");
			if (cancelled || !containerRef.current) return;

			const checkout = await AdyenCheckout({
				environment: clientKey.startsWith("live_") ? "live" : "test",
				clientKey,
				countryCode,
				onAdditionalDetails: (state: { data?: unknown }) => {
					onDetailsRef.current(state.data);
				},
				onError: (error: AdyenCheckoutError) => {
					onErrorRef.current(error.message ?? "Authentication failed.");
				},
			});
			if (cancelled || !containerRef.current) return;

			// createFromAction accepts Adyen's PaymentAction; response_data carries it
			// as opaque JSON, so we cast at the boundary.
			component = checkout.createFromAction(
				action as never,
			) as unknown as UIElement;
			component.mount(containerRef.current);
		})();

		return () => {
			cancelled = true;
			component?.unmount();
		};
	}, [action, clientKey, orderId]);

	return <div ref={containerRef} className="adyen-action-container" />;
}
