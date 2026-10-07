import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * PayPal through the Adyen Drop-in.
 *
 * Unlike Klarna, PayPal does not take the page away: the Drop-in opens PayPal
 * in a popup, the shopper logs in and approves there, and the popup closes back
 * into the Drop-in, which reports success. So this covers the Drop-in's own
 * success path (authorization created on CL once Adyen accepts the payment),
 * not the redirect return.
 *
 * Needs a PayPal sandbox buyer account linked to the Adyen test merchant, in
 * `E2E_PAYPAL_EMAIL` / `E2E_PAYPAL_PASSWORD` (`.env.local` is loaded for the
 * specs by `integration-api.ts`, through the page object).
 */
const email = process.env.E2E_PAYPAL_EMAIL;
const password = process.env.E2E_PAYPAL_PASSWORD;

test("pays with PayPal through the Adyen Drop-in", async ({
	checkout,
	page,
}) => {
	test.skip(
		!email || !password,
		"E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD not set",
	);
	test.setTimeout(150_000);

	await checkout.selectMethod("payment_setting_adyens");
	await checkout.confirm();

	const dropin = page.locator(".adyen-dropin-container");
	await dropin.getByRole("radio", { name: "PayPal" }).click();

	// PayPal's button lives in an iframe that the SDK draws before it wires
	// its click handler, so the click goes to the Drop-in's container around
	// it, forced, and is repeated until the popup actually opens.
	const paypalButton = dropin
		.locator(".adyen-checkout__paypal__button")
		.first();
	await expect(paypalButton).toBeVisible({ timeout: 60_000 });
	let popup: Page | undefined;
	for (let attempt = 1; attempt <= 5 && !popup; attempt++) {
		const popupPromise = page.waitForEvent("popup", { timeout: 10_000 });
		await paypalButton.click({ force: true });
		popup = await popupPromise.catch(() => undefined);
	}
	if (!popup) throw new Error("The PayPal popup never opened.");
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

	await checkout.expectPlaced();
	await expect(page.getByText(/payment authorization failed/i)).toHaveCount(0);
});
