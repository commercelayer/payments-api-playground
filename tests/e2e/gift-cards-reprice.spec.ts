import { expect, test } from "./fixtures";

/**
 * Re-price an order that gift cards already cover.
 *
 * `amount_cents` is fixed when a payment session is created, so changing the
 * shipping method leaves every gift card session sized for a total that no
 * longer exists. The checkout tears them down and re-applies them, which lets
 * the normal sizing rules pick the amounts again — the first card takes what it
 * is worth, the next one the balance still due.
 *
 * Figures are formatted as USD, the sandbox market currency.
 */

/** Formats cents the way the checkout does in the USD sandbox. */
function usd(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

test("rebuilds gift card sessions when the shipping method re-prices the order", async ({
	checkout,
}) => {
	const stamp = Date.now().toString(36).toUpperCase();
	const smallCode = `E2ES${stamp}`;
	const largeCode = `E2EL${stamp}`;

	const totalBefore = await checkout.orderTotalCents();
	expect(totalBefore).toBeGreaterThan(2000);

	// A small card that can never cover the order on its own, plus one with
	// enough balance to absorb whatever is left at either total.
	const smallCents = 100 * Math.floor(totalBefore / 400);
	await checkout.createGiftCard(smallCode, smallCents / 100);
	await checkout.createGiftCard(largeCode, Math.ceil(totalBefore / 100) + 50);

	await checkout.applyGiftCard(smallCode);
	await checkout.applyGiftCard(largeCode);

	// The two together cover the order exactly, so the entry closes.
	await expect(checkout.appliedGiftCard(smallCode)).toContainText(
		usd(smallCents),
	);
	await expect(checkout.appliedGiftCard(largeCode)).toContainText(
		usd(totalBefore - smallCents),
	);
	await expect(checkout.giftCardCounter()).toContainText("nothing left to pay");
	await expect(checkout.giftCardInput()).toBeDisabled();

	// ── Re-price ─────────────────────────────────────────────────────────────
	const totalAfter = await checkout.selectOtherShippingMethod();
	expect(totalAfter).not.toBe(totalBefore);

	// Both sessions are rebuilt: the small card is re-created for its own
	// balance, the large one for whatever the new total still leaves due.
	await expect(checkout.giftCardCounter()).toContainText(
		`Covered ${usd(totalAfter)} of ${usd(totalAfter)}`,
	);
	await expect(checkout.appliedGiftCard(smallCode)).toContainText(
		usd(smallCents),
	);
	await expect(checkout.appliedGiftCard(largeCode)).toContainText(
		usd(totalAfter - smallCents),
	);
	await expect(checkout.giftCardInput()).toBeDisabled();

	// The rebuilt sessions add up to the new total, so the order still places.
	await checkout.placeOrder();
	await checkout.expectPlaced();
});
