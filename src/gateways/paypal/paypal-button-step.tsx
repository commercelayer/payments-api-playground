"use client";

import type { OneTimePaymentSession } from "@paypal/paypal-js/sdk-v6";
import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/payments";

type Props = {
	clientId: string;
	/** The PayPal order CL created for the payment_session: its `token`. */
	paypalOrderId: string;
	authorizing: boolean;
	authorizeError: string | null;
	/** The shopper approved the payment in PayPal's window. */
	onApprove: () => Promise<void>;
	onError: (message: string | null) => void;
	onReset: () => void;
};

/**
 * PayPal's button, from the v6 JS SDK, bound to the PayPal order of the
 * payment_session.
 *
 * The SDK checks that PayPal can be offered to this shopper, then the button
 * opens PayPal's window on the order. Approving there only marks the PayPal
 * order as approved: no money moves until the CL authorization runs.
 */
export function PayPalButtonStep({
	clientId,
	paypalOrderId,
	authorizing,
	authorizeError,
	onApprove,
	onError,
	onReset,
}: Props) {
	const checkoutRef = useRef<OneTimePaymentSession | null>(null);
	const [ready, setReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	// PayPal's window is open.
	const [approving, setApproving] = useState(false);
	// The SDK keeps the callbacks it was created with, so they read the latest
	// props through refs.
	const onApproveRef = useRef(onApprove);
	onApproveRef.current = onApprove;
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

	useEffect(() => {
		let cancelled = false;
		let checkout: OneTimePaymentSession | null = null;

		(async () => {
			try {
				const paypal = await loadCoreSdkScript({ environment: "sandbox" });
				if (!paypal) throw new Error("PayPal's SDK did not load.");
				const sdk = await paypal.createInstance({
					clientId,
					components: ["paypal-payments"],
					pageType: "checkout",
				});
				const eligibility = await sdk.findEligibleMethods();
				if (cancelled) return;
				if (!eligibility.isEligible("paypal")) {
					throw new Error("PayPal is not available for this payment.");
				}
				checkout = sdk.createPayPalOneTimePaymentSession({
					onApprove: async () => {
						setApproving(false);
						await onApproveRef.current();
					},
					onCancel: () => {
						setApproving(false);
						onErrorRef.current(
							"PayPal was closed before the payment was approved.",
						);
					},
					onError: (e) => {
						setApproving(false);
						onErrorRef.current(errorMessage(e, "PayPal reported an error."));
					},
				});
				checkoutRef.current = checkout;
				setReady(true);
			} catch (e) {
				if (!cancelled) setLoadError(errorMessage(e, "Could not load PayPal."));
			}
		})();

		return () => {
			cancelled = true;
			checkoutRef.current = null;
			setReady(false);
			checkout?.destroy();
		};
	}, [clientId]);

	function handleClick() {
		const checkout = checkoutRef.current;
		if (!checkout) return;
		onError(null);
		setApproving(true);
		// Started right from the click: browsers only let a page open a window
		// from a user gesture, so nothing may be awaited before this call. The
		// PayPal order already exists, created with the payment_session.
		checkout
			.start(
				{ presentationMode: "auto" },
				Promise.resolve({ orderId: paypalOrderId }),
			)
			.catch((e) => {
				setApproving(false);
				onErrorRef.current(errorMessage(e, "Could not open PayPal."));
			});
	}

	const busy = approving || authorizing;

	return (
		<div className="flex flex-col gap-3" data-testid="paypal-checkout">
			{loadError ? (
				<p className="text-xs text-red-500">{loadError}</p>
			) : ready ? (
				<div className="max-w-xs">
					<paypal-button type="pay" disabled={busy} onClick={handleClick} />
				</div>
			) : (
				<p className="text-xs text-gray-400">Loading PayPal…</p>
			)}
			{authorizing && <p className="text-xs text-gray-500">Authorizing…</p>}
			{authorizeError && (
				<p className="text-xs text-red-500">{authorizeError}</p>
			)}
			<button
				type="button"
				onClick={onReset}
				disabled={busy}
				className="cursor-pointer self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
			>
				Cancel
			</button>
		</div>
	);
}
