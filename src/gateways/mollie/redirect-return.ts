import type { PaymentSession } from "@commercelayer/sdk";
import type { PaymentClient } from "@/lib/payments";

/** Query parameters on the return URL that `server/session.ts` gives Mollie. */
export const MOLLIE_RETURN_PARAMS = ["mollie_return"];

/** Whether the page was reached by Mollie sending the shopper back. */
export function isMollieReturn(searchParams: URLSearchParams): boolean {
	return searchParams.get("mollie_return") === "1";
}

/**
 * Finishes a Mollie payment once the shopper is back. The order can only hold
 * one open external session at a time, so that is the one that was paid.
 *
 * Creating the authorization makes CL call the setting's `authorize_url`
 * (`server/authorize.ts`), which asks Mollie whether the payment is paid and
 * refuses the authorization otherwise. Throws when it can't be completed. The
 * caller then places the order.
 */
export async function resumeMollieRedirect({
	client,
	paymentSessions,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	paymentSessions: PaymentSession[];
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	const session = paymentSessions.find(
		(s) =>
			s.payment_setting?.type === "payment_setting_externals" &&
			s.status === "unpaid" &&
			(s.payment_authorization == null ||
				s.payment_authorization.status === "failed"),
	);
	if (!session) {
		throw new Error(
			"Payment was completed but the session could not be found. Please refresh and try again.",
		);
	}

	await authorizeGiftCards();
	await client.payment_authorizations.create({
		payment_session: client.payment_sessions.relationship(session.id),
	});
}
