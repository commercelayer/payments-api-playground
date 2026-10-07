"use server";

import { revalidatePath } from "next/cache";
import { getIntegrationClient } from "@/lib/client";
import { DEBUG_PANELS_ENABLED } from "@/lib/debug-panels";

export async function createGiftCard(
	orderId: string,
	_prevState: { error: string | null; success: boolean },
	formData: FormData,
): Promise<{ error: string | null; success: boolean }> {
	const code = (formData.get("code") as string).trim();
	const amount = parseFloat(formData.get("amount") as string);
	const balanceCents = Math.round(amount * 100);

	// Server actions can be called directly, not only from the hidden panel.
	if (!DEBUG_PANELS_ENABLED)
		return { error: "Debug panels are disabled.", success: false };
	if (!code) return { error: "Code is required.", success: false };
	if (Number.isNaN(amount) || amount <= 0)
		return { error: "Invalid amount.", success: false };

	try {
		const client = await getIntegrationClient();
		// Created in the order's currency: a gift card in any other currency
		// can't be applied to it.
		const { currency_code: currencyCode } = await client.orders.retrieve(
			orderId,
			{ fields: { orders: ["currency_code"] } },
		);

		const gc = await client.gift_cards.create({
			code,
			currency_code: currencyCode,
			balance_cents: balanceCents,
		});
		await client.gift_cards._purchase(gc.id);
		await client.gift_cards._activate(gc.id);
	} catch (e) {
		return {
			error: e instanceof Error ? e.message : "Failed to create gift card.",
			success: false,
		};
	}

	revalidatePath(`/orders/${orderId}`);
	return { error: null, success: true };
}
