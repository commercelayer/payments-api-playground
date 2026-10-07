import type {
	Order,
	OrderSubscription,
	PaymentWallet,
} from "@commercelayer/sdk";
import type { createClient } from "./create-client";

type Client = ReturnType<typeof createClient>;

/**
 * Frequencies the checkout offers. Every one of them must also be listed on the
 * `subscription_model` bound to the order's market: the API validates the line
 * item against it and otherwise rejects the write with
 * `frequency - is not associated to a subscription model` (422). A market with
 * no subscription model at all cannot take a frequency on any line item, so
 * this is a market-level prerequisite, not something the storefront can set up.
 */
export const SUBSCRIPTION_FREQUENCIES = ["weekly", "monthly"] as const;

export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

/** Human label for a frequency, e.g. `weekly` → "Every week". */
export const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
	weekly: "Every week",
	monthly: "Every month",
};

/**
 * The line items a subscription can be generated from.
 *
 * Only SKU rows carry a frequency. The other rows on an order — shipments,
 * promotions, payment fees — are recomputed from scratch on every target order,
 * so CL neither reads nor accepts a frequency on them.
 */
export function recurringLineItems(order: Order) {
	return (order.line_items ?? []).filter((item) => item.item_type === "skus");
}

/** The frequency currently carried by the order, or null when it is a one-off.
 *
 * Read from the SKU rows rather than the order because that is where it lives:
 * the order itself has no frequency attribute. With the `by_frequency` strategy
 * the rows sharing a frequency collapse into a single subscription, and this
 * checkout sets one frequency for the whole order, so the first row is
 * representative. */
export function orderFrequency(order: Order): string | null {
	for (const item of recurringLineItems(order)) {
		if (item.frequency) return item.frequency;
	}
	return null;
}

/**
 * Marks (or unmarks) the order's SKU rows as recurring.
 *
 * `null` clears the frequency and turns the order back into a one-off. Rows
 * already carrying the requested value are skipped so that re-selecting the
 * current choice costs no API calls.
 *
 * Like every line item write, this rebuilds the order's shipments and drops the
 * shipping method already chosen on them — the shipment comes back with a new
 * id and no method. Callers must refresh the order afterwards so the shipping
 * step is shown again, otherwise placement fails with
 * `some shipments are missing the shipping method`.
 */
export async function setOrderFrequency(
	client: Client,
	order: Order,
	frequency: SubscriptionFrequency | null,
) {
	for (const item of recurringLineItems(order)) {
		if ((item.frequency ?? null) === frequency) continue;
		await client.line_items.update({ id: item.id, frequency });
	}
}

/**
 * Turns the placed order's recurring rows into `order_subscriptions`.
 *
 * Normally unnecessary: `_create_subscriptions` is accepted *upon* placing, so
 * the checkout sends it on the same patch as `_place` (see `pollAndPlace`). This
 * is the recovery path for an order that came back placed without its
 * subscriptions — the trigger is equally valid after the fact.
 *
 * Safe to repeat either way: CL stamps `subscription_created_at` on the order
 * and a second call does not mint a second subscription.
 *
 * CL copies the order's payment setting onto the subscription when that setting
 * is non-vaultable (wire transfer). A card gateway cannot be carried that way —
 * see `attachWallet`.
 */
export async function createSubscriptions(client: Client, orderId: string) {
	return client.orders._create_subscriptions(orderId);
}

/**
 * Moves the next charge to a chosen moment.
 *
 * `next_run_at` is a plain attribute, not a trigger, and CL only accepts a value
 * at or after the current time (`next_run_at - must start in the future or
 * current time`). Rescheduling shifts just the next occurrence; the frequency
 * keeps driving the ones after it.
 */
export async function rescheduleSubscription(
	client: Client,
	subscriptionId: string,
	nextRunAt: string,
) {
	return client.order_subscriptions.update({
		id: subscriptionId,
		next_run_at: nextRunAt,
	});
}

/** The subscriptions generated from an order, newest first.
 *
 * Read through the order rather than `order_subscriptions.list`, which a
 * sales-channel token is not authorized to call (403). Retrieving one by id and
 * including them on their source order both work, which is enough for a
 * storefront to show and manage what it just created. */
export async function fetchOrderSubscriptions(
	client: Client,
	orderId: string,
): Promise<OrderSubscription[]> {
	const order = await client.orders.retrieve(orderId, {
		include: [
			"order_subscriptions",
			"order_subscriptions.payment_setting",
			"order_subscriptions.payment_wallet",
			"order_subscriptions.order_subscription_items",
		],
	});
	return order.order_subscriptions ?? [];
}

/**
 * Binds the saved card that the subscription's future runs will be charged on.
 *
 * A subscription pays either through a plain payment setting or through a
 * wallet. Only a non-vaultable setting may be set directly — a card gateway is
 * refused with `payment_setting - cannot be vaultable`, because for those the
 * credential has to arrive as a `payment_wallet`, which carries its own setting
 * with it. Charging that wallet with no shopper present is the whole point of
 * the recurring flow.
 *
 * This is deliberately a separate step from placement: the wallet frequently
 * does not exist yet when the order is placed. An Adyen card saved during
 * checkout is turned into a wallet by CL from the gateway's delayed
 * `RECURRING_CONTRACT` webhook, which lands seconds later — so binding it is
 * something the shopper (or this page) does once the card actually shows up.
 */
export async function attachWallet(
	client: Client,
	subscriptionId: string,
	walletId: string,
) {
	return client.order_subscriptions.update(
		{
			id: subscriptionId,
			payment_wallet: client.payment_wallets.relationship(walletId),
		},
		{ include: ["payment_setting", "payment_wallet"] },
	);
}

/**
 * Starts a subscription, or restarts a paused one.
 *
 * Needed more often than it looks. A subscription created from a checkout where
 * the shopper saved a new card comes back `pending` and never runs on its own:
 * the wallet is created asynchronously, seconds later, so the session carried
 * none when the subscription was minted — and a card gateway cannot stand in for
 * it as `payment_setting` (see `attachWallet`). Reusing an already-saved card
 * carries the wallet from the start and activates normally, which makes this the
 * first-subscription case.
 *
 * `next_run_at` survives a pause and resume — the schedule is not rebuilt.
 */
export async function activateSubscription(
	client: Client,
	subscriptionId: string,
) {
	return client.order_subscriptions.update({
		id: subscriptionId,
		_activate: true,
	});
}

/** Pauses a subscription. It stops running but keeps its schedule, and
 * `activateSubscription` picks it back up. Unlike cancelling, this is
 * reversible. */
export async function deactivateSubscription(
	client: Client,
	subscriptionId: string,
) {
	return client.order_subscriptions.update({
		id: subscriptionId,
		_deactivate: true,
	});
}

/** Cancels a subscription. Irreversible: a cancelled subscription never runs
 * again and cannot be reactivated — pause it instead if it may resume. */
export async function cancelSubscription(
	client: Client,
	subscriptionId: string,
) {
	return client.order_subscriptions.update({
		id: subscriptionId,
		_cancel: true,
	});
}

/** The saved cards that can be bound to a subscription.
 *
 * Sorted newest first and filtered server-side: the default listing is oldest
 * first over a short page, which hides the card just saved during this very
 * checkout — exactly the one the shopper expects to pick. */
export async function fetchWallets(client: Client): Promise<PaymentWallet[]> {
	return client.payment_wallets.list({
		include: ["payment_setting"],
		filters: { status_eq: "succeeded" },
		sort: { created_at: "desc" },
		pageSize: 25,
	});
}
