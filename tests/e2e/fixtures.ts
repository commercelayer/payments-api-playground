import { test as base } from "@playwright/test";
import { CheckoutPage } from "./checkout-page";

/**
 * Extends Playwright's base test with a `checkout` fixture that has already
 * created an order and is sitting on the checkout page, ready for payment
 * selection. Specs import `test` from here and start straight from there.
 */
export const test = base.extend<{ checkout: CheckoutPage }>({
	checkout: async ({ page }, use) => {
		const checkout = new CheckoutPage(page);
		await checkout.create();
		await use(checkout);
	},
});

export { expect } from "@playwright/test";
