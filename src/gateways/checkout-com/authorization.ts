import type { PaymentSession } from "@commercelayer/sdk";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";

/**
 * Authorizes a session whose payment Flow already submitted and Checkout.com
 * approved. The Checkout.com payment id (`pay_…`) goes into the session's
 * `client_data.payment_method`, next to the return URLs already there: with
 * it, the CL payment_authorization reads that payment from Checkout.com
 * instead of submitting a new one. The authorization is polled until it
 * settles. Throws unless it succeeds.
 */
export async function authorizeCheckoutComPayment({
	client,
	session,
	paymentId,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	session: PaymentSession;
	paymentId: string;
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	await authorizeGiftCards();
	await client.payment_sessions.update({
		id: session.id,
		client_data: { ...session.client_data, payment_method: paymentId },
	});
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
