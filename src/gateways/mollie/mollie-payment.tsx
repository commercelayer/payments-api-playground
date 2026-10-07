"use client";

import { useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage } from "@/lib/payments";

/**
 * Payment through Mollie, connected to Commerce Layer as an external payment
 * setting. Unlike Stripe or Adyen, CL has no Mollie integration of its own:
 * it calls this app's gateway routes (`server/`), which talk to Mollie.
 *
 * 1. Confirm creates the payment_session. CL calls the setting's `session_url`
 *    (`server/session.ts`), which creates a Mollie payment and answers with
 *    its `checkout_url`. CL stores that answer in the session's
 *    `response_data`.
 * 2. The shopper is sent to the `checkout_url` and pays on Mollie's page.
 * 3. Mollie sends the shopper back with `?mollie_return=1`, and
 *    `redirect-return.ts` creates the CL payment_authorization. CL calls the
 *    setting's `authorize_url` (`server/authorize.ts`), which checks with
 *    Mollie that the payment was actually paid.
 *
 * Mollie also notifies `server/webhook.ts` on every status change, which
 * forwards the outcome to CL. That covers a shopper who pays but never comes
 * back to the page.
 */
export function MolliePayment({
	client,
	orderId,
	setting,
	amountCents,
}: GatewayPaymentProps) {
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);

	async function handleConfirm() {
		if (amountCents == null) return;
		setConfirming(true);
		setConfirmError(null);
		try {
			const session = await client.payment_sessions.create({
				amount_cents: amountCents,
				payment_setting: client.payment_settings.relationship(setting.id),
				order: client.orders.relationship(orderId),
			});
			const checkoutUrl = session.response_data?.data?.checkout_url;
			if (typeof checkoutUrl !== "string") {
				throw new Error("Gateway did not return a checkout URL.");
			}
			// The page unloads from here, so `confirming` is left on on purpose.
			window.location.href = checkoutUrl;
		} catch (e) {
			setConfirmError(errorMessage(e, "Failed to confirm payment."));
			setConfirming(false);
		}
	}

	return (
		<div className="mt-2 flex flex-col gap-2">
			<button
				type="button"
				onClick={handleConfirm}
				disabled={amountCents == null || confirming}
				className="cursor-pointer self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{confirming ? "Confirming…" : "Confirm"}
			</button>
			{confirmError && <p className="text-xs text-red-500">{confirmError}</p>}
		</div>
	);
}
