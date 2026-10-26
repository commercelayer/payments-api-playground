import type { PaymentSetting, PaymentWallet } from "@commercelayer/sdk";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";

/**
 * Pays with a card the customer stored with Braintree earlier.
 *
 * The session is created with the `payment_wallet` relationship and no nonce:
 * with nothing in `client_data.payment_method_id`, CL authorizes the wallet's
 * `payment_token`, the vaulted Braintree payment method. No card form mounts,
 * so the client token the session still carries goes unused.
 *
 * No 3-D Secure runs here: verifying a stored card needs a nonce minted from it,
 * which only the server-side Braintree API can do. CL relays the authorization
 * asynchronously, so it is polled until it settles.
 */
export async function payWithBraintreeWallet({
	client,
	orderId,
	wallet,
	setting,
	amountCents,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	orderId: string;
	wallet: PaymentWallet;
	setting: PaymentSetting;
	amountCents: number;
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	if (!wallet.payment_token) throw new Error("This saved card can't be used.");

	const session = await client.payment_sessions.create({
		amount_cents: amountCents,
		payment_setting: client.payment_settings.relationship(setting.id),
		order: client.orders.relationship(orderId),
		payment_wallet: client.payment_wallets.relationship(wallet.id),
	});

	await authorizeGiftCards();
	const created = await client.payment_authorizations.create({
		payment_session: client.payment_sessions.relationship(session.id),
	});
	const auth = await pollAuthorization(client, created.id);
	if (auth.status === "pending") {
		throw new Error(
			"The payment could not be confirmed. Please try again in a moment.",
		);
	}
	if (auth.status !== "succeeded") {
		throw new Error("The saved card was declined. Try another card.");
	}
}
