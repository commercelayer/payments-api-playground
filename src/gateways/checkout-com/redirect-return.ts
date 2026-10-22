import type { PaymentSession } from "@commercelayer/sdk";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";

/** Query parameters on the return URL: ours, set on the `success_url` and
 * `failure_url` that `checkout-com-payment.tsx` gives Checkout.com, and the
 * ones Checkout.com appends to it. */
export const CHECKOUT_COM_RETURN_PARAMS = [
	"checkout_com_return",
	"cko-payment-session-id",
	"cko-session-id",
	"cko-payment-id",
];

/** Whether the page was reached by Checkout.com sending the shopper back, and
 * through which URL: Flow leaves the page for a 3-D Secure challenge (or a
 * redirect payment method) and comes back to `success_url` once the payment
 * is approved, to `failure_url` otherwise. */
export function checkoutComReturn(
	searchParams: URLSearchParams,
): "success" | "failure" | null {
	const value = searchParams.get("checkout_com_return");
	return value === "success" || value === "failure" ? value : null;
}

/**
 * Finishes a Checkout.com payment once the shopper is back. On the inline
 * path Flow's `onPaymentCompleted` does this; after a redirect Flow is gone,
 * so the order page does it here. Checkout.com already holds the approved
 * payment: creating the authorization makes CL pick it up, as on the inline
 * path. Throws when it can't be completed. The caller then places the order.
 */
export async function resumeCheckoutComRedirect({
	client,
	paymentSessions,
	outcome,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	paymentSessions: PaymentSession[];
	outcome: "success" | "failure";
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	if (outcome === "failure") {
		throw new Error(
			"The payment was not completed. Try again or use another card.",
		);
	}
	const session = paymentSessions.find(
		(s) =>
			s.payment_setting?.type === "payment_setting_checkout_coms" &&
			s.status === "unpaid",
	);
	if (!session) {
		throw new Error(
			"Payment was completed but the session could not be found. Please refresh and try again.",
		);
	}

	await authorizeGiftCards();
	const created = await client.payment_authorizations.create({
		payment_session: client.payment_sessions.relationship(session.id),
	});
	const auth = await pollAuthorization(client, created.id);
	if (auth.status !== "succeeded") {
		throw new Error(
			`The payment was not authorized (authorization ${auth.status}).`,
		);
	}
}
