import { expect, test } from "./fixtures";

/**
 * Remove a gift card that was never authorized.
 *
 * The session holds nothing at this point, so removal deletes it outright and
 * the balance it was covering goes back to being due. (A gift card that has
 * already been authorized is debited, and Remove refunds it instead — that path
 * needs a placement that failed midway, which this suite cannot stage.)
 */
test("removes an unauthorized gift card and restores the balance due", async ({
	checkout,
}) => {
	const code = `E2ER${Date.now().toString(36).toUpperCase()}`;
	const totalCents = await checkout.orderTotalCents();
	const cardCents = 100 * Math.floor(totalCents / 400);

	await checkout.createGiftCard(code, cardCents / 100);
	await checkout.applyGiftCard(code);
	await expect(checkout.giftCardCounter()).toContainText(
		`${usd(totalCents - cardCents)} left`,
	);

	await checkout.removeGiftCard(code);

	// Nothing covers the order any more, so the counter goes away entirely.
	await expect(checkout.appliedGiftCard(code)).toHaveCount(0);
	await expect(checkout.giftCardCounter()).toHaveCount(0);
	await expect(checkout.giftCardInput()).toBeEnabled();
});

/** Formats cents the way the checkout does in the USD sandbox. */
function usd(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}
