import { authenticate } from "@commercelayer/js-auth";
import { CommerceLayer } from "@commercelayer/sdk";

// The specs run outside Next, so `.env.local` is not loaded for them — only the
// `next dev` web server reads it. Missing is fine when the variables are
// already in the environment.
try {
	process.loadEnvFile(".env.local");
} catch {}

async function integrationClient() {
	const clientId = process.env.CL_INTEGRATION_CLIENT_ID;
	const clientSecret = process.env.CL_INTEGRATION_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			"Missing CL_INTEGRATION_CLIENT_ID / CL_INTEGRATION_CLIENT_SECRET",
		);
	}
	const auth = await authenticate("client_credentials", {
		clientId,
		clientSecret,
		domain: process.env.CL_DOMAIN,
	});
	return CommerceLayer({
		accessToken: auth.accessToken,
		apiVersion: "2026-05",
	});
}

/**
 * Reads an order through an integration token, which sees what the storefront
 * token may not — e.g. a subscription a trigger created behind the checkout's
 * back. Returns both sides of the order's subscription relationship and the
 * line-item frequencies, which is everything that marks an order as taking
 * part in a subscription.
 */
export async function fetchOrderSubscriptionState(orderId: string) {
	const client = await integrationClient();
	const order = await client.orders.retrieve(orderId, {
		include: ["order_subscriptions", "order_subscription", "line_items"],
	});
	return {
		status: order.status,
		seededSubscriptions: order.order_subscriptions ?? [],
		generatedBy: order.order_subscription ?? null,
		frequencies: (order.line_items ?? [])
			.map((li) => li.frequency)
			.filter(Boolean),
	};
}

/**
 * Raises the quantity of the order's SKU line item until the order total
 * reaches `minCents`. Setting the quantity directly takes one or two writes,
 * where stepping it up from the checkout re-prices the order once per unit.
 *
 * The first estimate uses the unit price without taxes or shipping, so it
 * stays a little short and the loop tops it up a unit at a time. Like any line
 * item write, it clears the shipping method already chosen.
 */
export async function raiseOrderTotalTo(
	orderId: string,
	minCents: number,
): Promise<void> {
	const client = await integrationClient();
	for (;;) {
		const order = await client.orders.retrieve(orderId, {
			include: ["line_items"],
		});
		const total = order.total_amount_with_taxes_cents ?? 0;
		if (total >= minCents) return;
		const item = order.line_items?.find((li) => li.item_type === "skus");
		if (!item?.unit_amount_cents) {
			throw new Error(`Order ${orderId} has no priced SKU line item.`);
		}
		const missingUnits = Math.max(
			1,
			Math.floor((minCents - total) / item.unit_amount_cents),
		);
		await client.line_items.update({
			id: item.id,
			quantity: item.quantity + missingUnits,
		});
	}
}
