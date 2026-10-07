import { expect, test } from "./fixtures";

/**
 * Create a gift card, apply it to the order, then pay the remaining balance with
 * Stripe. The gift card is created in the market currency (USD in this sandbox),
 * since a gift card must match the order currency to apply — a literal EUR card
 * would not reduce a USD order.
 */
test("applies a gift card and pays the remaining with Stripe", async ({
	checkout,
}) => {
	// Unique code so parallel/repeat runs don't collide on an existing gift card.
	const code = `E2E${Date.now().toString(36).toUpperCase()}`;

	await checkout.createGiftCard(code, 10);
	await checkout.applyGiftCard(code);

	// Pay whatever is left after the gift card; selecting Stripe auto-fills it.
	await checkout.selectMethod("payment_setting_stripes");
	await checkout.confirm();
	await expect(checkout.stripeCardNumber()).toBeVisible();
	await checkout.fillStripeTestCard();
	await checkout.authorize();

	await checkout.expectPlaced();
});
