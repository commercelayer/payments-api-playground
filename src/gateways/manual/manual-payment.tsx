"use client";

import { useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage } from "@/lib/payments";

/**
 * Manual payment (wire transfer, cash on delivery): no gateway and nothing to
 * collect from the shopper. Confirm creates the payment_session and its
 * authorization right away; the money is reconciled outside Commerce Layer.
 */
export function ManualPayment({
	client,
	orderId,
	setting,
	amountCents,
	authorizeGiftCards,
	onAuthorized,
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
			await authorizeGiftCards();
			await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
			});
			onAuthorized();
		} catch (e) {
			setConfirmError(errorMessage(e, "Failed to confirm payment."));
		} finally {
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
