import type { Order } from "@commercelayer/sdk";
import type {
	BillingDetails,
	ShippingAddress,
	ShippingRate,
} from "@stripe/stripe-js";
import type { PaymentClient } from "./payments";

/** The redacted address a wallet exposes while its sheet is open — real
 * country/state/city/zip, no street/name. Gateway-agnostic: Stripe's
 * `ExpressCheckoutPartialAddress` and an Apple Pay `shippingContact` both map
 * onto this shape, so both express flows can share `applyRedactedAddress`. */
export type RedactedAddress = {
	country?: string | null;
	state?: string | null;
	city?: string | null;
	postal_code?: string | null;
};

/**
 * Helpers that drive a Commerce Layer draft order through the Stripe Express
 * Checkout Element (Apple Pay / Google Pay) lifecycle from the product page.
 *
 * The wallet only reveals a *redacted address* (country/state/city/zip) while
 * the sheet is open, and the full address + email only at authorization. CL's
 * `addresses` resource still requires `line_1` + name + phone to validate, so
 * the redacted phase writes PLACEHOLDER values that `finalizeExpressOrder`
 * overwrites at confirm. (This placeholder requirement is a documented API gap.)
 */

const PLACEHOLDER = {
	first_name: "Express",
	last_name: "Checkout",
	line_1: "Pending — set at authorization",
	phone: "0000000000",
} as const;

/** Fields we retrieve on every recalculation. */
const RECALC_PARAMS = {
	include: [
		"shipments.available_shipping_methods",
		"shipments.shipping_method",
	],
};

function splitName(name: string | undefined): {
	first_name: string;
	last_name: string;
} {
	const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0)
		return {
			first_name: PLACEHOLDER.first_name,
			last_name: PLACEHOLDER.last_name,
		};
	const [first, ...rest] = parts;
	return {
		first_name: first,
		last_name: rest.join(" ") || PLACEHOLDER.last_name,
	};
}

/**
 * Create the guest draft order + line item once. Returns the (possibly
 * pre-existing) order id so the shipping callback is idempotent across the
 * multiple times a buyer may change address inside the sheet.
 */
export async function ensureExpressOrder(
	client: PaymentClient,
	skuCode: string,
	currentOrderId: string | null,
): Promise<string> {
	if (currentOrderId) return currentOrderId;
	const order = await client.orders.create({});
	await client.line_items.create({
		quantity: 1,
		sku_code: skuCode,
		order: client.orders.relationship(order.id),
	});
	return order.id;
}

/**
 * Write the redacted address (real country/state/city/zip + placeholder
 * line_1/name/phone) and attach it to the order. Reuses the same address record
 * across changes. Returns the address id.
 */
export async function applyRedactedAddress(
	client: PaymentClient,
	orderId: string,
	addressId: string | null,
	addr: RedactedAddress,
): Promise<string> {
	const data = {
		country_code: addr.country ?? "",
		state_code: addr.state || "—",
		city: addr.city || "—",
		zip_code: addr.postal_code || "—",
		line_1: PLACEHOLDER.line_1,
		first_name: PLACEHOLDER.first_name,
		last_name: PLACEHOLDER.last_name,
		phone: PLACEHOLDER.phone,
	};

	if (addressId) {
		await client.addresses.update({ id: addressId, ...data });
		return addressId;
	}

	const address = await client.addresses.create(data);
	await client.orders.update({
		id: orderId,
		shipping_address: client.addresses.relationship(address.id),
		billing_address: client.addresses.relationship(address.id),
	});
	return address.id;
}

/** Re-read the order with shipments, methods and totals. */
export async function recalcOrder(
	client: PaymentClient,
	orderId: string,
): Promise<Order> {
	return client.orders.retrieve(orderId, RECALC_PARAMS);
}

/** Ensure every shipment has a shipping method selected (defaults to the first
 * available one) so CL can compute a taxed total. */
export async function ensureShippingMethods(
	client: PaymentClient,
	order: Order,
): Promise<void> {
	for (const shipment of order.shipments ?? []) {
		if (shipment.shipping_method) continue;
		const [method] = shipment.available_shipping_methods ?? [];
		if (method) {
			await client.shipments.update({
				id: shipment.id,
				shipping_method: client.shipping_methods.relationship(method.id),
			});
		}
	}
}

/** Switch the (single) shipment to a specific shipping method id. */
export async function selectShippingMethod(
	client: PaymentClient,
	order: Order,
	methodId: string,
): Promise<void> {
	const shipment = order.shipments?.[0];
	if (!shipment) return;
	await client.shipments.update({
		id: shipment.id,
		shipping_method: client.shipping_methods.relationship(methodId),
	});
}

/** Map the first shipment's available methods to Stripe shipping rates. Uses
 * the free-over-aware `price_amount_for_shipment_cents` when present. */
export function mapShippingRates(order: Order): ShippingRate[] {
	const methods = order.shipments?.[0]?.available_shipping_methods ?? [];
	return methods.map((m) => ({
		id: m.id,
		displayName: m.name ?? "Shipping",
		amount: m.price_amount_for_shipment_cents ?? m.price_amount_cents ?? 0,
	}));
}

/**
 * The amount to charge = the full CL total including shipping and taxes.
 *
 * Verified in Safari: the Express Checkout Element does NOT auto-add the
 * selected shipping rate to `elements.amount`; the displayed/charged total is
 * simply `elements.amount`, and `shippingRates` are selectable labels only. So
 * we drive `elements.amount` with the full CL total on every recalculation.
 */
export function expressAmounts(order: Order): {
	totalCents: number;
	shippingCents: number;
} {
	const totalCents =
		order.total_amount_with_taxes_cents ?? order.total_amount_cents ?? 0;
	const shippingCents = order.shipping_amount_cents ?? 0;
	return { totalCents, shippingCents };
}

/**
 * At authorization: overwrite the placeholder shipping address with the real
 * one, create the real billing address, and set the customer email (guest only).
 */
export async function finalizeExpressOrder(
	client: PaymentClient,
	orderId: string,
	shippingAddressId: string | null,
	params: {
		shipping?: ShippingAddress;
		billing?: BillingDetails;
		setEmail: boolean;
	},
): Promise<void> {
	const { shipping, billing } = params;

	if (shipping && shippingAddressId) {
		await client.addresses.update({
			id: shippingAddressId,
			...splitName(shipping.name),
			line_1: shipping.address.line1 || PLACEHOLDER.line_1,
			line_2: shipping.address.line2 ?? undefined,
			city: shipping.address.city,
			state_code: shipping.address.state,
			zip_code: shipping.address.postal_code,
			country_code: shipping.address.country,
		});
	}

	if (billing) {
		const billingAddress = await client.addresses.create({
			...splitName(billing.name),
			line_1: billing.address.line1 || PLACEHOLDER.line_1,
			line_2: billing.address.line2 ?? undefined,
			city: billing.address.city,
			state_code: billing.address.state,
			zip_code: billing.address.postal_code,
			country_code: billing.address.country,
			phone: billing.phone || PLACEHOLDER.phone,
		});
		await client.orders.update({
			id: orderId,
			billing_address: client.addresses.relationship(billingAddress.id),
		});
	}

	if (params.setEmail && billing?.email) {
		await client.orders.update({ id: orderId, customer_email: billing.email });
	}
}
