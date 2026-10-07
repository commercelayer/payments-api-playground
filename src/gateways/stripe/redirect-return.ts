import type { PaymentSession, PaymentSettingStripe } from "@commercelayer/sdk";
import { loadStripe } from "@stripe/stripe-js";
import type { PaymentClient } from "@/lib/payments";

/** Query parameters Stripe appends to the `return_url` when a redirect-based
 * method (Amazon Pay, or a 3-D Secure redirect) sends the shopper back. */
export const STRIPE_RETURN_PARAMS = [
	"payment_intent",
	"payment_intent_client_secret",
	"redirect_status",
];

/** The PaymentIntent `client_secret` of a Stripe redirect return, or null when
 * the page was not reached from one. */
export function stripeReturnClientSecret(
	searchParams: URLSearchParams,
): string | null {
	return searchParams.get("payment_intent_client_secret");
}

/**
 * Finishes a Stripe payment the shopper completed off-site. The redirect
 * wiped the page's state, so everything is recovered from the URL and the
 * order's sessions:
 *
 * 1. Find the payment_session whose PaymentIntent `client_secret` came back.
 * 2. Ask Stripe whether that PaymentIntent was actually authorized: a shopper
 *    can come back from a payment that failed or was abandoned.
 * 3. Create the CL payment_authorization, unless an earlier visit already did.
 *
 * Throws when the payment can't be confirmed. The caller then places the
 * order.
 */
export async function resumeStripeRedirect({
	client,
	paymentSessions,
	clientSecret,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	paymentSessions: PaymentSession[];
	clientSecret: string;
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	const session = paymentSessions.find(
		(s) =>
			s.payment_setting?.type === "payment_setting_stripes" &&
			s.response_data?.client_secret === clientSecret,
	);
	if (!session) {
		throw new Error(
			"Payment was completed on Amazon but the session could not be found. Please refresh and try again.",
		);
	}

	const publicKey = (session.payment_setting as PaymentSettingStripe)
		.public_key;
	if (!publicKey) {
		throw new Error(
			"Could not find Stripe configuration. Please refresh and try again.",
		);
	}

	const stripe = await loadStripe(publicKey);
	if (!stripe) throw new Error("Failed to load Stripe.");
	const { paymentIntent, error } =
		await stripe.retrievePaymentIntent(clientSecret);
	if (error) {
		throw new Error(error.message ?? "Failed to verify payment status.");
	}
	const status = paymentIntent?.status;
	if (
		status !== "requires_capture" &&
		status !== "succeeded" &&
		status !== "processing"
	) {
		throw new Error(
			`Payment is not authorized (status: ${status ?? "unknown"}). Please try again.`,
		);
	}

	await authorizeGiftCards();
	if (session.payment_authorization == null) {
		await client.payment_authorizations.create({
			payment_session: client.payment_sessions.relationship(session.id),
		});
	}
}
