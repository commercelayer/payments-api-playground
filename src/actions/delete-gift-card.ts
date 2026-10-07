"use server";

import { revalidatePath } from "next/cache";
import { getIntegrationClient } from "@/lib/client";
import { DEBUG_PANELS_ENABLED } from "@/lib/debug-panels";

export async function deleteGiftCard(orderId: string, formData: FormData) {
	// Server actions can be called directly, not only from the hidden panel.
	if (!DEBUG_PANELS_ENABLED) throw new Error("Debug panels are disabled.");
	const id = formData.get("id") as string;
	const client = await getIntegrationClient();
	await client.gift_cards.delete(id);
	revalidatePath(`/orders/${orderId}`);
}
