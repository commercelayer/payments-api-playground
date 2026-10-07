import { expect, test } from "./fixtures";

/**
 * A Drop-in payment that leaves the page and comes back.
 *
 * Klarna is the reliable way to get a full-page redirect out of the Drop-in: the
 * card 3-D Secure challenges it raises stay inside the page. Adyen returns to
 * the order page with its own `sessionId` next to `redirectResult`, and the
 * Drop-in that started the payment is gone by then — the return has to finish
 * the Adyen session itself before anything is authorized on CL.
 *
 * Runs against Klarna's playground, which sends no SMS and accepts any
 * six-digit code.
 */
test("finishes a Drop-in payment after a Klarna redirect", async ({
	checkout,
	page,
}) => {
	test.setTimeout(150_000);

	await checkout.selectMethod("payment_setting_adyens");
	await checkout.confirm();

	const dropin = page.locator(".adyen-dropin-container");
	await dropin.getByRole("radio", { name: "Pay later with Klarna." }).click();
	await dropin
		.getByRole("button", { name: /klarna/i })
		.filter({ visible: true })
		.first()
		.click();
	await page.waitForURL(/playground\.klarna\.com/, { timeout: 30_000 });

	await page
		.getByRole("textbox")
		.first()
		.fill("3106683312", { timeout: 30_000 });
	await page.getByRole("button", { name: "Continue" }).click();
	await page
		.getByText("Enter the 6-digit code")
		.first()
		.waitFor({ timeout: 30_000 });
	await page.getByRole("textbox").first().pressSequentially("123456", {
		delay: 60,
	});

	// The confirmation step loads as a page of its own on another Klarna host,
	// sometimes after a login hop; wait for it to settle before looking for it.
	await page.waitForURL(/payments\.playground\.klarna\.com/, {
		timeout: 30_000,
	});
	await page
		.getByRole("button", { name: "Pay with Klarna" })
		.click({ timeout: 30_000 });

	await page.waitForURL(/localhost:3000\/orders\/.+sessionId=/, {
		timeout: 45_000,
	});
	await checkout.expectPlaced();
	await expect(page.getByText(/no authorization is awaiting/)).toHaveCount(0);
});
