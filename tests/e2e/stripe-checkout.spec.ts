import { expect, test } from "./fixtures";

/**
 * Create a Stripe payment session for the full order amount,
 * pay with a test card, and confirm the order is placed.
 */
test("pays the full amount with Stripe and places the order", async ({
	checkout,
}) => {
	// Selecting Stripe auto-fills the amount with the full remaining balance.
	await checkout.selectMethod("payment_setting_stripes");
	await expect(checkout.amountInput()).not.toHaveValue("");

	await checkout.confirm();

	// #2: the Stripe Elements iframe only renders once the session's
	// response_data.client_secret exists — so its appearance confirms the
	// payment session was created for the full amount.
	await expect(checkout.stripeCardNumber()).toBeVisible();

	// #3: complete the card payment and wait for placement.
	await checkout.fillStripeTestCard();
	await checkout.authorize();
	await checkout.expectPlaced();
});
