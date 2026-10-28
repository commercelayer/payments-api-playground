import { CheckoutPage } from "./checkout-page";
import { expect, test } from "./fixtures";

/**
 * Checkout.com card payments through Flow. Flow submits the payment to
 * Checkout.com with its own Pay button; once it is approved, the checkout
 * authorizes the CL session with the Checkout.com payment id.
 */
test("pays with Checkout.com after a 3-D Secure challenge and places the order", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_checkout_coms");
	await checkout.confirm();

	await checkout.fillCheckoutComTestCard();
	await checkout.submitCheckoutCom();
	await checkout.completeCheckoutComChallenge();

	await checkout.expectPlaced();
});

test("pays with Checkout.com when 3-D Secure authenticates frictionlessly", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_checkout_coms");
	await checkout.confirm();

	await checkout.fillCheckoutComTestCard("4485040371536584");
	await checkout.submitCheckoutCom();

	await checkout.expectPlaced();
});

/**
 * A failed challenge leaves the page: Checkout.com sends the shopper to the
 * session's `failure_url`. The checkout says so, clears the return parameters
 * and mounts Flow again on the same session, where another card can pay.
 */
test("a failed Checkout.com 3-D Secure challenge leaves the payment open for a retry", async ({
	checkout,
	page,
}) => {
	test.setTimeout(120_000);

	await checkout.selectMethod("payment_setting_checkout_coms");
	await checkout.confirm();

	await checkout.fillCheckoutComTestCard();
	await checkout.submitCheckoutCom();
	await checkout.failCheckoutComChallenge();

	await page.waitForURL(/checkout_com_return=failure/, { timeout: 30_000 });
	await expect(
		page.getByText(
			"The payment was not completed. Try again or use another card.",
		),
	).toBeVisible({ timeout: 30_000 });
	await expect(page).not.toHaveURL(/checkout_com_return/);

	await checkout.fillCheckoutComTestCard("4485040371536584");
	await checkout.submitCheckoutCom();

	await checkout.expectPlaced();
});

/**
 * Checkout.com doesn't store cards yet, and an order that mints a subscription
 * needs a stored card for the orders after it, so the method isn't offered.
 */
test("Checkout.com is not offered for an order that creates a subscription", async ({
	page,
}) => {
	const checkout = new CheckoutPage(page);
	await checkout.loginAsCustomer();
	await checkout.create();
	await checkout.selectFrequency("Every week");
	await checkout.selectFirstShippingMethod();

	await checkout.selectMethod("payment_setting_checkout_coms");

	await expect(
		page.getByText("Checkout.com can't save cards here yet"),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
});
