import type { PaymentSession } from "@commercelayer/sdk";
import { TransactionRow } from "./transaction-row";

/**
 * Renders the Session / Authorization / Capture rows for a single payment
 * session. Shared by the placed-order audit view and the active-checkout
 * "Authorized payments" list.
 */
export function SessionTransactionRows({
	session,
}: {
	session: PaymentSession;
}) {
	const isGiftCard =
		session.payment_setting?.type === "payment_setting_gift_cards";
	const auth = session.payment_authorization ?? null;
	const captures = session.payment_captures ?? [];

	return (
		<div className="flex flex-col gap-1.5">
			<TransactionRow
				label="Session"
				id={session.id}
				status={session.status}
				amountCents={session.amount_cents}
				currency={session.currency_code}
				prefix={isGiftCard ? "−" : undefined}
			/>
			{auth && (
				<TransactionRow
					label="Authorization"
					id={auth.id}
					status={auth.status}
					amountCents={auth.amount_cents}
					currency={auth.currency_code}
					indent
				/>
			)}
			{captures.map((cap) => (
				<TransactionRow
					key={cap.id}
					label="Capture"
					id={cap.id}
					status={cap.status}
					amountCents={cap.amount_cents}
					currency={cap.currency_code}
					indent
				/>
			))}
		</div>
	);
}
