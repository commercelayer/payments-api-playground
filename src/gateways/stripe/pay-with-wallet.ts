import type { PaymentSettingStripe, PaymentWallet } from "@commercelayer/sdk";
import { loadStripe } from "@stripe/stripe-js";
import type { PaymentClient } from "@/lib/payments";

/**
 * Pays with a card the customer stored with Stripe earlier.
 *
 * The session is created with the `payment_wallet` relationship, and the
 * wallet is what carries the stored card: CL builds the PaymentIntent from its
 * `payment_token` (the Stripe payment method) and `customer_token` (the Stripe
 * customer). Passing them through `options` instead is refused for a
 * storefront token.
 *
 * When CL hands back a `client_secret`, the PaymentIntent still needs the
 * shopper's confirmation, typically for 3-D Secure, so Stripe confirms it with
 * the stored payment method before the CL authorization is created.
 */
export async function payWithStripeWallet({
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
	setting: PaymentSettingStripe;
	amountCents: number;
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	if (!setting.public_key || !wallet.payment_token) {
		throw new Error("This saved card can't be used.");
	}

	const session = await client.payment_sessions.create({
		amount_cents: amountCents,
		payment_setting: client.payment_settings.relationship(setting.id),
		order: client.orders.relationship(orderId),
		payment_wallet: client.payment_wallets.relationship(wallet.id),
	});

	const clientSecret = session.response_data?.client_secret;
	if (typeof clientSecret === "string" && clientSecret.startsWith("pi_")) {
		const stripe = await loadStripe(setting.public_key);
		if (!stripe) throw new Error("Failed to load Stripe.");
		const { error } = await stripe.confirmPayment({
			clientSecret,
			confirmParams: {
				payment_method: wallet.payment_token,
				return_url: window.location.origin + window.location.pathname,
			},
			redirect: "if_required",
		});
		if (error) throw new Error(error.message ?? "Payment confirmation failed.");
	}

	await authorizeGiftCards();
	await client.payment_authorizations.create({
		payment_session: client.payment_sessions.relationship(session.id),
	});
}
