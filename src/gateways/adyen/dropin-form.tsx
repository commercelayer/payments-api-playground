"use client";

import "@adyen/adyen-web/styles/adyen.css";
import type {
	AdyenCheckoutError,
	CoreConfiguration,
	PaymentCompletedData,
	UIElement,
} from "@adyen/adyen-web";
import { useEffect, useRef } from "react";

type Props = {
	sessionId: string;
	sessionData: string;
	clientKey: string;
	onAuthorized: () => void;
	onError: (message: string) => void;
};

export function AdyenPaymentForm({
	sessionId,
	sessionData,
	clientKey,
	onAuthorized,
	onError,
}: Props) {
	const containerRef = useRef<HTMLDivElement>(null);

	// Stable refs so the effect doesn't re-run when callbacks change identity
	const onAuthorizedRef = useRef(onAuthorized);
	const onErrorRef = useRef(onError);
	onAuthorizedRef.current = onAuthorized;
	onErrorRef.current = onError;

	useEffect(() => {
		if (!containerRef.current) return;
		let dropin: UIElement | null = null;
		let cancelled = false;

		(async () => {
			const {
				AdyenCheckout,
				Dropin,
				Card,
				PayPal,
				Klarna,
				GooglePay,
				ApplePay,
			} = await import("@adyen/adyen-web");
			if (cancelled || !containerRef.current) return;

			const config: CoreConfiguration = {
				environment: clientKey.startsWith("live_") ? "live" : "test",
				clientKey,
				session: { id: sessionId, sessionData },
				onPaymentCompleted: (data: PaymentCompletedData) => {
					const resultCode = "resultCode" in data ? data.resultCode : undefined;
					if (
						resultCode === "Authorised" ||
						resultCode === "Pending" ||
						resultCode === "Received"
					) {
						onAuthorizedRef.current();
					} else {
						onErrorRef.current(
							`Payment ${resultCode?.toLowerCase() ?? "failed"}`,
						);
					}
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
			console.log(
				"Adyen paymentMethodsResponse:",
				checkout.paymentMethodsResponse,
			);
			if (cancelled || !containerRef.current) {
				checkout.remove(checkout as never);
				return;
			}

			dropin = new Dropin(checkout, {
				paymentMethodComponents: [Card, PayPal, Klarna, ApplePay, GooglePay],
				// A vaulting session carries the customer's shopperReference, so Adyen
				// returns every card stored under it and the Drop-in leads with them.
				// Kept on deliberately: this is a playground, and showing Adyen's own
				// list next to the one built from CL's payment_wallets makes it easy to
				// spot when the two disagree (a wallet removed in CL stays stored on
				// Adyen). Paying with a card from here bypasses the payment_wallet, so
				// the session is not linked to one.
				showStoredPaymentMethods: true,
			});
			dropin.mount(containerRef.current);
		})();

		return () => {
			cancelled = true;
			dropin?.unmount();
		};
	}, [sessionId, sessionData, clientKey]);

	return <div ref={containerRef} className="adyen-dropin-container" />;
}
