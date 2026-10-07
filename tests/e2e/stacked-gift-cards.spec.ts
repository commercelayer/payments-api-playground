import { expect, test } from "./fixtures";

/**
 * Stack several gift cards on one order.
 *
 * The first card is applied with no `amount_cents`, letting the API size the
 * session; every later one carries the balance still due, because the API sizes
 * an amount-less session to the order total still to be *authorized* and gift
 * cards are only authorized at place-order time — a card already applied is
 * invisible to that calculation and a second amount-less session would be
 * created for the whole order again.
 *
 * The amounts are derived from the order total rather than hard-coded, so the
 * scenario survives a catalog price change. Figures are formatted as USD, the
 * sandbox market currency (a gift card must match the order currency to apply).
 */

/** Formats cents the way the checkout does in the USD sandbox. */
function usd(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

test("stacks gift cards, sizing each session to what is still due", async ({
	checkout,
}) => {
	// Unique codes so parallel/repeat runs don't collide on an existing gift card.
	const stamp = Date.now().toString(36).toUpperCase();
	const firstCode = `E2EA${stamp}`;
	const partialCode = `E2EB${stamp}`;
	const finalCode = `E2EC${stamp}`;

	const totalCents = await checkout.orderTotalCents();
	// Guards the arithmetic below (whole-dollar cards, each smaller than the
	// order) rather than the app: a tiny order would make the scenario vacuous.
	expect(totalCents).toBeGreaterThan(2000);

	// ── First card: nothing covers the order yet, so no amount is sent and the
	// session is created for the card's full balance.
	const firstCents = 100 * Math.floor(totalCents / 200);
	await checkout.createGiftCard(firstCode, firstCents / 100);
	await checkout.applyGiftCard(firstCode);

	await expect(checkout.appliedGiftCard(firstCode)).toContainText(
		usd(firstCents),
	);
	await expect(checkout.giftCardCounter()).toContainText(
		`Covered ${usd(firstCents)} of ${usd(totalCents)}`,
	);
	await expect(checkout.giftCardCounter()).toContainText(
		`${usd(totalCents - firstCents)} left`,
	);

	// ── The same code twice is refused client-side: a second session would claim
	// a balance the first one has already spoken for.
	await checkout.submitGiftCard(firstCode);
	await expect(
		checkout.page.getByText("This gift card is already applied to the order."),
	).toBeVisible();
	await expect(checkout.appliedGiftCard(firstCode)).toHaveCount(1);

	// ── Second card, worth less than what is due: the session is requested for
	// the whole remaining balance but comes back worth only the card's balance,
	// so part of the order is still unpaid and the entry stays open.
	const partialCents = 500;
	await checkout.createGiftCard(partialCode, partialCents / 100);
	await checkout.applyGiftCard(partialCode);

	const coveredCents = firstCents + partialCents;
	await expect(checkout.appliedGiftCard(partialCode)).toContainText(
		usd(partialCents),
	);
	await expect(checkout.giftCardCounter()).toContainText(
		`Covered ${usd(coveredCents)} of ${usd(totalCents)}`,
	);
	await expect(checkout.giftCardCounter()).toContainText(
		`${usd(totalCents - coveredCents)} left`,
	);
	await expect(checkout.giftCardInput()).toBeEnabled();

	// ── Third card, worth more than what is due: the session is capped at the
	// remaining balance instead of swallowing the card, and the entry closes.
	const dueCents = totalCents - coveredCents;
	await checkout.createGiftCard(finalCode, Math.ceil(dueCents / 100) + 10);
	await checkout.applyGiftCard(finalCode);

	await expect(checkout.appliedGiftCard(finalCode)).toContainText(
		usd(dueCents),
	);
	await expect(checkout.giftCardCounter()).toContainText("nothing left to pay");
	await expect(checkout.giftCardInput()).toBeDisabled();

	// Gift cards alone cover the order, so no payment method is ever selected.
	await checkout.placeOrder();
	await checkout.expectPlaced();
});
