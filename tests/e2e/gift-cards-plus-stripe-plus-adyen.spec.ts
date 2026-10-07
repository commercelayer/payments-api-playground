import { expect, test } from "./fixtures";

/**
 * Split a single order across four payments: two gift cards ($10 + $20), a
 * partial Stripe card payment ($20), and Adyen for whatever is left.
 *
 * Gift cards are created in the market currency (USD in this sandbox), since a
 * gift card must match the order currency to apply. They reduce the remaining
 * balance immediately; their sessions are authorized at place-order time.
 *
 * The amount field auto-fills with the full remaining balance on method select,
 * so the Stripe payment is capped manually to $20; Adyen then uses the suggested
 * remaining balance to close out the order.
 */
test("pays with two gift cards, a partial Stripe payment, and Adyen for the rest", async ({
	checkout,
}) => {
	// Unique codes so parallel/repeat runs don't collide on an existing gift card.
	const stamp = Date.now().toString(36).toUpperCase();
	const giftCard10 = `E2E${stamp}A`;
	const giftCard20 = `E2E${stamp}B`;

	await checkout.createGiftCard(giftCard10, 10);
	await checkout.createGiftCard(giftCard20, 20);
	await checkout.applyGiftCard(giftCard10);
	await checkout.applyGiftCard(giftCard20);

	// Stripe: override the auto-filled remaining balance to a $20 partial payment.
	await checkout.selectMethod("payment_setting_stripes");
	await checkout.setAmount(20);
	await checkout.confirm();
	await expect(checkout.stripeCardNumber()).toBeVisible();
	await checkout.fillStripeTestCard();
	await checkout.authorize();

	// The Stripe partial payment locks in; the remaining balance updates.
	await checkout.expectAuthorizedPayment();

	// Adyen: pay the rest using the default suggested remaining balance.
	await checkout.selectMethod("payment_setting_adyens");
	await checkout.confirm();
	await checkout.fillAdyenTestCard();
	await checkout.submitAdyen();

	await checkout.expectPlaced();
});
