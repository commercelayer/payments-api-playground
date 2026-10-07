import type { PaymentSession, PaymentSetting } from "@commercelayer/sdk";

/**
 * Session statuses whose `amount_cents` no longer stands for money the order
 * actually holds: it has been given back, released, or only partly settled.
 *
 * The test has to be on the session's own status. The relationships that would
 * prove a reversal — `payment_void` on the session and on its authorization,
 * and `payment_refunds` — are not readable by a storefront token: they come
 * back null or empty rather than missing, so a check against them passes
 * silently and counts reversed money as coverage.
 *
 * A partial state is counted as nothing rather than as its net value, which
 * cannot be computed here for the same reason — the refunds that would say how
 * much came back are invisible. Asking the customer for a balance that turns
 * out to be already covered is recoverable; placing an underpaid order is not.
 */
const PARTIAL_OR_REVERSED_STATUSES = [
	"refunded",
	"partially_refunded",
	"voided",
	"partially_paid",
];

export type DerivedPaymentState = {
	giftCardSetting: PaymentSetting | undefined;
	paymentMethodSettings: PaymentSetting[];
	appliedGiftCards: PaymentSession[];
	activeGiftCardSessions: PaymentSession[];
	authorizedMethodSessions: PaymentSession[];
	openMethodSessions: PaymentSession[];
	restoredMethodSession: PaymentSession | null;
	coveredPaymentAmountCents: number;
	remainingPaymentAmountCents: number;
	nextGiftCardAmountCents: number | null;
	canApplyGiftCard: boolean;
};

/**
 * Derives every payment-related view value from the raw order props.
 *
 * Pure (no React, no side effects): given the current sessions, the market's
 * payment settings, and the order total, it computes which gift cards are
 * applied, which method sessions are locked in, whether a previous attempt can
 * be restored, and the balance still owed. The component re-runs this on each
 * render after the parent refreshes the session list.
 */
export function derivePaymentState(
	paymentSessions: PaymentSession[],
	availablePaymentSettings: PaymentSetting[],
	orderTotalAmountCents: number,
): DerivedPaymentState {
	const giftCardSetting = availablePaymentSettings.find(
		(s) => s.type === "payment_setting_gift_cards",
	);
	const paymentMethodSettings = availablePaymentSettings.filter(
		(s) => s.type !== "payment_setting_gift_cards",
	);

	// Exclude gift card sessions that have been refunded (placement failure
	// rollback) — they no longer reduce the balance or need authorization.
	// Refunded sessions drop out entirely: the balance has gone back to the gift
	// card, so the session belongs neither in the list nor in the covered total.
	//
	// The test is on `status` and not on `payment_refunds` because a storefront
	// sales-channel token cannot read payment_refunds — the relationship comes
	// back *empty* rather than missing even when the include asks for it, which
	// silently turns a `payment_refunds.length` check into a no-op. `status` is
	// readable by that token and already reads "refunded".
	const appliedGiftCards = paymentSessions.filter(
		(s) =>
			s.payment_setting?.type === "payment_setting_gift_cards" &&
			s.status !== "refunded",
	);
	const activeGiftCardSessions = appliedGiftCards.filter(
		(s) => !PARTIAL_OR_REVERSED_STATUSES.includes(s.status),
	);

	// Non-gift-card sessions holding money — these reduce the remaining balance
	// and are shown as locked-in partial payments. A failed/declined
	// authorization doesn't lock in any amount, so it must not reduce the
	// remaining balance (otherwise the "Add payment" section would be hidden
	// even though the payment still needs to be retried); neither does a
	// session whose money has since been returned or only partly settled.
	const authorizedMethodSessions = paymentSessions.filter(
		(s) =>
			s.payment_setting?.type !== "payment_setting_gift_cards" &&
			s.payment_authorization != null &&
			s.payment_authorization.status !== "failed" &&
			s.payment_authorization.status !== "declined" &&
			!PARTIAL_OR_REVERSED_STATUSES.includes(s.status),
	);

	// Non-gift-card sessions left over from a previous attempt: still "unpaid"
	// and either without an authorization or with a failed or declined one, so
	// they hold no money. They were sized for a balance that no longer applies once a gift
	// card is added or removed, and `amount_cents` can't be updated after
	// creation, so they are safe (and necessary) to discard at that point.
	const openMethodSessions = paymentSessions.filter(
		(s) =>
			s.payment_setting?.type !== "payment_setting_gift_cards" &&
			s.status === "unpaid" &&
			(s.payment_authorization == null ||
				s.payment_authorization.status === "failed" ||
				s.payment_authorization.status === "declined"),
	);

	const activeGiftCardAmountCents = activeGiftCardSessions.reduce(
		(total, s) => total + (s.amount_cents ?? 0),
		0,
	);

	// Restore a leftover session as the pre-selected method (and pending Stripe
	// session) so the customer can resume or retry, rather than starting from
	// scratch — but only if it (together with any applied gift cards) covers the
	// full order amount. A leftover session for a smaller, stale amount is not
	// restored.
	const restoredMethodSession =
		openMethodSessions.find(
			(s) =>
				(s.amount_cents ?? 0) + activeGiftCardAmountCents >=
				orderTotalAmountCents,
		) ?? null;

	// How much of the order is already spoken for. Gift cards count at face
	// value as soon as applied (even before authorization, which happens at
	// place-order time); method sessions count only once a payment_authorization
	// exists. This is the counter the gift card section shows and the one the
	// next gift card's amount is derived from.
	const coveredPaymentAmountCents =
		activeGiftCardAmountCents +
		authorizedMethodSessions.reduce(
			(total, s) => total + (s.amount_cents ?? 0),
			0,
		);

	// Remaining balance drives the "Add payment" form visibility and the
	// auto-place trigger.
	const remainingPaymentAmountCents = Math.max(
		0,
		orderTotalAmountCents - coveredPaymentAmountCents,
	);

	// The amount to send when creating the next gift card session, or null to
	// let the API size it.
	//
	// Commerce Layer sizes a gift card session created without `amount_cents` to
	// the order total still to be authorized. Gift card sessions are only
	// authorized at place-order time, so a gift card that is already applied is
	// invisible to that calculation: a second session created without an amount
	// would be sized to the whole balance again and over-collect. So the amount
	// is left to the API only while nothing covers the order yet; from the
	// second gift card on (or after a partial payment is authorized) it carries
	// what is actually left.
	//
	// The session still comes back sized to the gift card's real balance, which
	// may be lower than what was asked for — that is why the remaining balance
	// has to be re-read after every apply rather than assumed to be zero.
	const nextGiftCardAmountCents =
		coveredPaymentAmountCents === 0 ? null : remainingPaymentAmountCents;

	// Nothing left to pay means a further gift card would be created for zero,
	// so the input is closed rather than left to fail.
	const canApplyGiftCard = remainingPaymentAmountCents > 0;

	return {
		giftCardSetting,
		paymentMethodSettings,
		appliedGiftCards,
		activeGiftCardSessions,
		authorizedMethodSessions,
		openMethodSessions,
		restoredMethodSession,
		coveredPaymentAmountCents,
		remainingPaymentAmountCents,
		nextGiftCardAmountCents,
		canApplyGiftCard,
	};
}
