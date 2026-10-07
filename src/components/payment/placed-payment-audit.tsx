import type { PaymentSession } from "@commercelayer/sdk";
import { labelForType } from "@/lib/payment-labels";
import { SessionTransactionRows } from "./session-transaction-rows";

/**
 * Read-only audit view shown once the order is placed (or approved /
 * cancelled). Lists every session, authorization, and capture with status
 * badges.
 */
export function PlacedPaymentAudit({
	paymentSessions,
}: {
	paymentSessions: PaymentSession[];
}) {
	const giftCardSessions = paymentSessions.filter(
		(s) => s.payment_setting?.type === "payment_setting_gift_cards",
	);
	const methodSessions = paymentSessions.filter(
		(s) => s.payment_setting?.type !== "payment_setting_gift_cards",
	);
	const allSessions = [...methodSessions, ...giftCardSessions];

	return (
		<section className="rounded-2xl border border-gray-200 bg-white">
			<div className="border-b border-gray-100 px-6 py-4">
				<h2 className="font-semibold">Payment</h2>
			</div>

			{allSessions.length === 0 && (
				<p className="px-6 py-5 text-sm text-gray-400">No payment recorded.</p>
			)}

			<ul className="divide-y divide-gray-100">
				{allSessions.map((s) => {
					const isGiftCard =
						s.payment_setting?.type === "payment_setting_gift_cards";
					const methodLabel = isGiftCard
						? (s.gift_card_code ?? "Gift card")
						: (s.payment_setting?.name ??
							labelForType(s.payment_setting?.type ?? ""));

					return (
						<li key={s.id} className="px-6 py-4">
							<p className="mb-3 text-sm font-semibold text-gray-800">
								{methodLabel}
							</p>
							<SessionTransactionRows session={s} />
						</li>
					);
				})}
			</ul>
		</section>
	);
}
