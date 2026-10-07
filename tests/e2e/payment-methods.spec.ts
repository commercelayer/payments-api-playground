import { expect, test } from "./fixtures";

/**
 * Scope #1 — the checkout opens and shows the available payment settings in the
 * "Add payment" block. Asserts on the stable CL type tags rather than the
 * editable display names.
 */
const EXPECTED_METHOD_TYPES = [
	"payment_setting_manuals", // Wire Transfer
	"payment_setting_stripes", // Stripe
	"payment_setting_externals", // Mollie
	"payment_setting_adyens", // Adyen
	"payment_setting_braintrees", // Braintree
];

test("checkout shows the available payment methods", async ({ checkout }) => {
	const { page } = checkout;

	await expect(checkout.addPaymentHeading).toBeVisible();

	for (const type of EXPECTED_METHOD_TYPES) {
		await expect(page.getByText(type, { exact: true })).toBeVisible();
	}

	await expect(checkout.paymentMethodOptions()).toHaveCount(
		EXPECTED_METHOD_TYPES.length,
	);
});
