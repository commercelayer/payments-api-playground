import type { Page } from "@playwright/test";
import { CheckoutPage } from "./checkout-page";
import { expect, test } from "./fixtures";

/**
 * Card storing through the session's `vaulting` flag.
 *
 * The storefront only asks for the card to be stored; CL stores it during the
 * charge and creates the payment_wallet itself, so nothing here writes a wallet.
 * What proves it worked is the wallet showing up on the customer afterwards —
 * as a saved card on the next checkout, or as the instrument that activates a
 * subscription created from the same order.
 */

/** Saved cards offered on the checkout page, one row per wallet. */
async function savedCardCount(page: Page): Promise<number> {
	// Wallets are fetched after mount, so give the list a moment to arrive.
	await page.waitForTimeout(2_000);
	return page.getByRole("button", { name: "Remove saved card" }).count();
}

async function payWithStripe(checkout: CheckoutPage): Promise<void> {
	await checkout.selectMethod("payment_setting_stripes");
	await checkout.confirm();
	await expect(checkout.stripeCardNumber()).toBeVisible();
	await checkout.fillStripeTestCard();
	await checkout.authorize();
	await checkout.expectPlaced();
}

test.describe("vaulting", () => {
	test("saves a Stripe card on a one-off order when the shopper opts in", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();
		const before = await savedCardCount(page);

		await checkout.selectMethod("payment_setting_stripes");
		await page
			.getByRole("checkbox", { name: "Save card for future use" })
			.check();
		await checkout.confirm();
		await expect(checkout.stripeCardNumber()).toBeVisible();
		await checkout.fillStripeTestCard();
		await checkout.authorize();
		await checkout.expectPlaced();

		// The wallet is linked when CL processes the authorization, which can land
		// a little after placement.
		await expect
			.poll(
				async () => {
					await checkout.create();
					return savedCardCount(page);
				},
				{ timeout: 60_000, intervals: [2_000] },
			)
			.toBeGreaterThan(before);
	});

	test("does not save a Stripe card when the shopper leaves it unticked", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();
		const before = await savedCardCount(page);

		await payWithStripe(checkout);

		await checkout.create();
		expect(await savedCardCount(page)).toBe(before);
	});

	test("activates a weekly subscription paid with a new Stripe card", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectFrequency("Every week");
		await checkout.selectFirstShippingMethod();
		await payWithStripe(checkout);

		// The subscription is created before the wallet exists, then activated by
		// CL once the stored card turns into a wallet. The page does not watch for
		// that, so reload until it shows.
		const orderUrl = page.url();
		const section = checkout.subscriptionSection();
		await expect
			.poll(
				async () => {
					await page.goto(orderUrl);
					await section
						.getByText(/^(active|inactive|pending|draft)$/)
						.first()
						.waitFor({ timeout: 20_000 })
						.catch(() => {});
					return section.getByText("active", { exact: true }).count();
				},
				{ timeout: 90_000, intervals: [3_000] },
			)
			.toBeGreaterThan(0);
	});

	test("activates a weekly subscription paid with a new Adyen card", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectFrequency("Every week");
		await checkout.selectFirstShippingMethod();
		await checkout.selectMethod("payment_setting_adyens");
		await checkout.confirm();
		await checkout.fillAdyenTestCard();

		// The Drop-in asks for consent itself (CL sends askForConsent), and on a
		// recurring order nothing on this side can tick it on the shopper's behalf.
		// Adyen hides the native input behind a styled label, so tick it through
		// the label and read the state back from the input.
		const dropin = page.locator(".adyen-dropin-container");
		await dropin.locator(".adyen-checkout__checkbox").first().click();
		await expect(dropin.getByRole("checkbox", { name: /save/i })).toBeChecked();
		await checkout.submitAdyen();
		await checkout.expectPlaced();

		// Here the wallet comes from Adyen's RECURRING_CONTRACT webhook, which
		// lands later than Stripe's, so allow for it.
		const orderUrl = page.url();
		const section = checkout.subscriptionSection();
		await expect
			.poll(
				async () => {
					await page.goto(orderUrl);
					await section
						.getByText(/^(active|inactive|pending|draft)$/)
						.first()
						.waitFor({ timeout: 20_000 })
						.catch(() => {});
					return section.getByText("active", { exact: true }).count();
				},
				{ timeout: 120_000, intervals: [5_000] },
			)
			.toBeGreaterThan(0);
	});

	test("pays again with a saved Stripe card", async ({ page }) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		const stripeCard = page
			.locator("li")
			.filter({ hasText: /stripe/i })
			.filter({ has: page.getByRole("button", { name: "Pay", exact: true }) })
			.first();
		await expect(stripeCard).toBeVisible();
		await stripeCard.getByRole("button", { name: "Pay", exact: true }).click();
		await checkout.expectPlaced();
	});
});
