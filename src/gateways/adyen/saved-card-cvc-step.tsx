"use client";

import "@adyen/adyen-web/styles/adyen.css";
import type {
	AdyenCheckoutError,
	CoreConfiguration,
	SubmitActions,
	SubmitData,
	UIElement,
} from "@adyen/adyen-web";
import { useEffect, useRef } from "react";
import { getOrderCountryCode } from "./actions";

/**
 * Collects a fresh CVC for a stored Adyen card, with NO session (advanced flow).
 *
 * When a merchant keeps Adyen's "CVC required for stored cards" policy on, a
 * card-on-file /payments call is refused (`14_029 cvc not provided`) unless it
 * carries a shopper-entered CVC. We mount a bare adyen-web Card bound to the
 * stored payment method: it renders only Adyen's secured CVC iframe, so the raw
 * digits never touch our code (PCI SAQ A) and adyen-web encrypts them into an
 * `encryptedSecurityCode` blob.
 *
 * On submit we hand back `state.data.paymentMethod` (`{ type, storedPaymentMethodId,
 * encryptedSecurityCode }`) and `state.data.browserInfo`. The caller forwards them in
 * `client_data` (`payment_method` + `browser_info`) alongside the `payment_wallet`
 * relationship and `_internal_version: "WalletCvv"`; CL then forces
 * `shopperInteraction: Ecommerce`, merges the CVC, and requires native 3DS. Any
 * returned 3DS action is handled by <AdyenActionStep>. (`browserInfo` is mandatory
 * once native 3DS is signalled — Adyen 15_002 without it.)
 */
export function AdyenWalletCvcStep({
	orderId,
	storedPaymentMethodId,
	brand,
	clientKey,
	amountCents,
	currencyCode,
	onSubmit,
	onError,
}: {
	orderId: string;
	storedPaymentMethodId: string;
	/** Adyen brand code of the stored card (e.g. "visa", "mc"). Required: a
	 * single-secured-field (CVC-only) card must declare its brand. */
	brand: string;
	clientKey: string;
	amountCents: number;
	currencyCode: string;
	/** Fires once when the shopper submits — with the encrypted-CVC paymentMethod
	 * and adyen-web's browserInfo (CL needs both for the reuse /payments + native
	 * 3DS; browserInfo maps to client_data.browser_info). */
	onSubmit: (
		paymentMethod: Record<string, unknown>,
		browserInfo: unknown,
	) => void;
	onError: (message: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const submittedRef = useRef(false);
	const onSubmitRef = useRef(onSubmit);
	const onErrorRef = useRef(onError);
	onSubmitRef.current = onSubmit;
	onErrorRef.current = onError;

	useEffect(() => {
		if (!containerRef.current) return;
		let component: UIElement | null = null;
		let cancelled = false;

		function handleSubmit(state: SubmitData, actions: SubmitActions) {
			if (submittedRef.current) return;
			const data = state.data as {
				paymentMethod?: Record<string, unknown>;
				browserInfo?: unknown;
			};
			if (!data.paymentMethod) {
				actions.reject();
				return;
			}
			submittedRef.current = true;
			// We drive CL/Adyen ourselves from here; the parent unmounts this
			// component once it takes over, so adyen-web's submit promise is left
			// pending intentionally (no resolve/reject needed).
			onSubmitRef.current(data.paymentMethod, data.browserInfo);
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
					handleSubmit(state, actions);
				},
				onError: (error: AdyenCheckoutError) => {
					onErrorRef.current(
						error.message ?? "Could not read the security code.",
					);
				},
			};

			const checkout = await AdyenCheckout(config);
			if (cancelled || !containerRef.current) {
				checkout.remove(checkout as never);
				return;
			}

			// storedPaymentMethodId + Ecommerce interaction → the Card renders as a
			// stored card (CVC secured field only); state.data.paymentMethod carries
			// { type, storedPaymentMethodId, encryptedSecurityCode }. `brands` is
			// required in single-secured-field mode so adyen-web knows the card brand.
			component = new Card(checkout, {
				storedPaymentMethodId,
				supportedShopperInteractions: ["Ecommerce"],
				brands: [brand],
			}) as unknown as UIElement;
			component.mount(containerRef.current);
		})();

		return () => {
			cancelled = true;
			component?.unmount();
		};
	}, [
		orderId,
		storedPaymentMethodId,
		brand,
		clientKey,
		amountCents,
		currencyCode,
	]);

	return <div ref={containerRef} className="adyen-cvc-container" />;
}
