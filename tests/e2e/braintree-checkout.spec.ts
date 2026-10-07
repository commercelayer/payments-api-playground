import { expect, test } from "./fixtures";

/**
 * Braintree card payments: Hosted Fields (or, behind a toggle, the Drop-in)
 * collect the card, 3-D Secure runs in the browser, and the 3DS-verified nonce
 * is written to the session before the CL authorization is created.
 */
test("pays with Braintree after a 3-D Secure challenge and places the order", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_braintrees");
	await checkout.confirm();

	await checkout.fillBraintreeTestCard();
	await checkout.authorize();
	await checkout.completeBraintreeChallenge();

	await checkout.expectPlaced();
});

test("pays with Braintree when 3-D Secure authenticates frictionlessly", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_braintrees");
	await checkout.confirm();

	await checkout.fillBraintreeTestCard("4000000000001000");
	await checkout.authorize();

	await checkout.expectPlaced();
});

test("pays with the Braintree Drop-in after a 3-D Secure challenge", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_braintrees");
	await checkout.useBraintreeDropin();
	await checkout.confirm();

	await expect(checkout.page.getByTestId("braintree-dropin")).toBeVisible();
	// Not the card the Hosted Fields challenge test uses: Braintree's duplicate
	// check rejects the same card for the same amount within a short window
	// (GATEWAY_REJECTED), and every fixture order has the same total.
	await checkout.fillBraintreeTestCard("4000000000001091");
	await checkout.authorize();
	await checkout.completeBraintreeChallenge();

	await checkout.expectPlaced();
});

test("a declined Braintree card leaves the payment open for a retry", async ({
	checkout,
}) => {
	const { page } = checkout;

	await checkout.raiseTotalTo(200_000);
	const total = await checkout.orderTotalCents();
	expect(total).toBeLessThan(300_000);

	await checkout.selectMethod("payment_setting_braintrees");
	await checkout.confirm();

	await checkout.fillBraintreeTestCard();
	await checkout.authorize();
	await checkout.completeBraintreeChallenge();

	await expect(
		page.getByText("The card was declined. Try another card."),
	).toBeVisible({ timeout: 45_000 });

	// The session stays open: the form is still there, Authorize is usable
	// again, and nothing counts towards the total.
	await expect(page.getByTestId("braintree-card-form")).toBeVisible();
	await expect(page.getByRole("button", { name: "Authorize" })).toBeEnabled();
	expect(await checkout.remainingAmountCents()).toBe(total);
});
