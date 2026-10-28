"use client";

import type { CheckoutError } from "@checkout.com/checkout-web-components";
import type { PaymentSession } from "@commercelayer/sdk";
import { useEffect, useRef, useState } from "react";

/**
 * Checkout.com Flow, mounted on the Checkout.com payment session CL created
 * for this payment_session and returned whole in its `response_data` (`id`,
 * `payment_session_secret`, `payment_session_token`).
 *
 * Flow renders the methods the account offers (card, and Apple Pay / Google
 * Pay where the browser supports them) with its own pay button, submits the
 * payment to Checkout.com and shows a decline itself. `onCompleted` fires only
 * once a payment is approved, with its Checkout.com payment id.
 */
export function CheckoutComFlowStep({
	pendingSession,
	publicKey,
	authorizeError,
	onCompleted,
	onError,
	onReset,
}: {
	pendingSession: PaymentSession;
	publicKey: string;
	authorizeError: string | null;
	onCompleted: (paymentId: string) => void;
	onError: (message: string) => void;
	onReset: () => void;
}) {
	const paymentSession =
		pendingSession.response_data != null &&
		typeof pendingSession.response_data.payment_session_secret === "string"
			? pendingSession.response_data
			: null;

	const containerRef = useRef<HTMLDivElement>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	// Stable refs so the effect doesn't re-run when callbacks change identity
	const callbacksRef = useRef({ onCompleted, onError });
	callbacksRef.current = { onCompleted, onError };

	useEffect(() => {
		if (!paymentSession || !containerRef.current) return;
		const container = containerRef.current;
		let cancelled = false;
		let unmount: (() => void) | null = null;

		(async () => {
			try {
				const { loadCheckoutWebComponents } = await import(
					"@checkout.com/checkout-web-components"
				);
				const checkout = await loadCheckoutWebComponents({
					publicKey,
					paymentSession,
					environment: publicKey.startsWith("pk_sbox_")
						? "sandbox"
						: "production",
				});
				if (cancelled) return;
				const flow = checkout.create("flow", {
					onPaymentCompleted: (_component, payment) =>
						callbacksRef.current.onCompleted(payment.id),
					onError: (_component, error: CheckoutError) =>
						callbacksRef.current.onError(error.message),
				});
				flow.mount(container);
				unmount = () => flow.unmount();
			} catch (e) {
				if (!cancelled)
					setLoadError(
						e instanceof Error
							? e.message
							: "Could not load Checkout.com Flow.",
					);
			}
		})();

		return () => {
			cancelled = true;
			unmount?.();
		};
	}, [paymentSession, publicKey]);

	return (
		<div className="flex flex-col gap-3">
			{paymentSession ? (
				<div ref={containerRef} data-testid="checkout-com-flow" />
			) : (
				<p className="text-xs text-red-500">
					Checkout.com did not return a payment session for this session.
				</p>
			)}
			{(loadError ?? authorizeError) && (
				<p className="text-xs text-red-500">{loadError ?? authorizeError}</p>
			)}
			<button
				type="button"
				onClick={onReset}
				className="cursor-pointer self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400"
			>
				Cancel
			</button>
		</div>
	);
}
