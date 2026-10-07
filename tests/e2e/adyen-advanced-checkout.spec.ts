import { CheckoutPage } from "./checkout-page";
import { test } from "./fixtures";

/**
 * Adyen's advanced flow: the Card Component mounts without a payment_session,
 * and the session, the authorization and the payment_wallet are all created
 * server-side when the card is submitted. Stored cards are paid through the
 * same flow, with the CVC entered again.
 */

test("pays the full amount with the Adyen advanced-flow card", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_adyens");
	await checkout.useAdyenAdvancedCard();
	await checkout.confirm();
	await checkout.payWithAdyenAdvancedCard();
	await checkout.expectPlaced();
});

test("saves an advanced-flow card and pays with it again", async ({ page }) => {
	const checkout = new CheckoutPage(page);
	await checkout.loginAsCustomer();

	await checkout.create();
	await checkout.selectMethod("payment_setting_adyens");
	await checkout.useAdyenAdvancedCard();
	await checkout.confirm();
	await checkout.payWithAdyenAdvancedCard({ save: true });
	await checkout.expectPlaced();

	// The advanced flow creates the payment_wallet together with the
	// authorization, so the card is offered on the very next checkout.
	await checkout.create();
	await checkout.payWithSavedAdyenCard();
	await checkout.expectPlaced();
});
