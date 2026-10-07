import { test } from "./fixtures";

/**
 * Full payment with Adyen: select Adyen, fill the Drop-in card form with a test
 * card, submit, and confirm the order is placed. Unlike Stripe there is no
 * separate Authorize button — the Drop-in's own Pay button drives authorization
 * via its onPaymentCompleted callback.
 */
test("pays the full amount with Adyen and places the order", async ({
	checkout,
}) => {
	await checkout.selectMethod("payment_setting_adyens");
	await checkout.confirm();

	await checkout.fillAdyenTestCard();
	await checkout.submitAdyen();

	await checkout.expectPlaced();
});
