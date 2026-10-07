import type { PaymentSession } from "@commercelayer/sdk";
import { labelForType } from "@/lib/payment-labels";
import { SessionTransactionRows } from "./session-transaction-rows";

/**
 * The "Authorized payments" block in active checkout — locked-in partial
 * payments (non-gift-card sessions with a live authorization), each with its
 * session/authorization/capture rows.
 */
export function AuthorizedPaymentsList({
	sessions,
}: {
	sessions: PaymentSession[];
}) {
	return (
		<div className="px-6 py-5">
			<p className="mb-3 text-sm font-medium text-gray-700">
				Authorized payments
			</p>
			<ul className="flex flex-col gap-4">
				{sessions.map((s) => {
					const methodLabel =
						s.payment_setting?.name ??
						labelForType(s.payment_setting?.type ?? "");
					return (
						<li key={s.id}>
							<p className="mb-2 text-sm font-semibold text-gray-800">
								{methodLabel}
							</p>
							<SessionTransactionRows session={s} />
						</li>
					);
				})}
			</ul>
		</div>
	);
}
