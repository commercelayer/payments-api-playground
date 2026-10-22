import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fetchPayPalAuthorizedAmounts } from "./integration-api";

/**
 * PayPal through a PayPal payment setting. Confirm creates the PayPal order,
 * PayPal's button opens it in a popup, the shopper logs in and approves there,
 * and the CL authorization runs once the popup closes.
 *
 * Needs a PayPal sandbox buyer account in `E2E_PAYPAL_EMAIL` /
 * `E2E_PAYPAL_PASSWORD`.
 */
const email = process.env.E2E_PAYPAL_EMAIL;
const password = process.env.E2E_PAYPAL_PASSWORD;

test.beforeEach(() => {
	test.skip(
		!email || !password,
		"E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD not set",
	);
	test.setTimeout(150_000);
});

/** Clicks PayPal's button, then logs in and pays in the popup it opens. */
async function approveInPayPal(page: Page): Promise<void> {
	const button = page.getByTestId("paypal-checkout").locator("paypal-button");
	await expect(button).toBeVisible({ timeout: 30_000 });
	const popupPromise = page.waitForEvent("popup", { timeout: 30_000 });
	await button.click();
	const popup = await popupPromise;
	await popup.waitForLoadState();

	// Two-step sign-in: the email is submitted on its own, and the password
	// field does not exist until it has been.
	await popup.fill("input[name=login_email]", email as string);
	await popup.click("#btnNext");
	await popup.fill("input[name=login_password]", password as string);
	await popup.click("#btnLogin");

	const cookieBanner = popup.locator("#gdpr-container >> text=Accept");
	if (await cookieBanner.isVisible().catch(() => false)) {
		await cookieBanner.click();
	}

	// "Pay", with the sandbox account's default funding source.
	await popup.click('[data-testid="submit-button-initial"]', {
		timeout: 60_000,
	});
	await popup.waitForEvent("close", { timeout: 45_000 });
}

function orderIdOf(page: Page): string {
	const id = new URL(page.url()).pathname.split("/").pop();
	if (!id) throw new Error("Not on an order page.");
	return id;
}

test("pays with PayPal and places the order", async ({ checkout, page }) => {
	await checkout.selectMethod("payment_setting_paypals");
	await checkout.confirm();
	await approveInPayPal(page);

	await checkout.expectPlaced();
	await expect(page.getByText(/payment authorization failed/i)).toHaveCount(0);
});

test("applies a gift card and pays the remaining with PayPal", async ({
	checkout,
	page,
}) => {
	const code = `E2E${Date.now().toString(36).toUpperCase()}`;
	await checkout.createGiftCard(code, 10);
	await checkout.applyGiftCard(code);
	const remaining = await checkout.remainingAmountCents();

	await checkout.selectMethod("payment_setting_paypals");
	await checkout.confirm();
	await approveInPayPal(page);

	await checkout.expectPlaced();
	// PayPal holds the remaining balance only, not the order total.
	expect(await fetchPayPalAuthorizedAmounts(orderIdOf(page))).toEqual([
		{ sessionCents: remaining, paypalCents: remaining },
	]);
});
