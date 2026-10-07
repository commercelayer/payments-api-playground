"use server";

import { redirect } from "next/navigation";
import { getAuthOwnerType, getClient } from "@/lib/client";
import { CUSTOMER_EMAIL, ORDER_ADDRESS } from "@/lib/order-defaults";

export async function createOrder(skuCode: string, _formData?: FormData) {
	const client = await getClient();
	const ownerType = await getAuthOwnerType();
	const customerEmail =
		ownerType === "customer"
			? (process.env.CL_CUSTOMER_EMAIL ?? CUSTOMER_EMAIL)
			: CUSTOMER_EMAIL;

	const address = await client.addresses.create(ORDER_ADDRESS);

	const order = await client.orders.create({
		customer_email: customerEmail,
		billing_address: client.addresses.relationship(address.id),
		shipping_address: client.addresses.relationship(address.id),
	});

	await client.line_items.create({
		quantity: 1,
		sku_code: skuCode,
		order: client.orders.relationship(order.id),
	});

	const { shipments } = await client.orders.retrieve(order.id, {
		include: ["shipments.available_shipping_methods"],
	});

	for (const shipment of shipments ?? []) {
		const [shippingMethod] = shipment.available_shipping_methods ?? [];
		if (shippingMethod) {
			await client.shipments.update({
				id: shipment.id,
				shipping_method: client.shipping_methods.relationship(
					shippingMethod.id,
				),
			});
		}
	}

	redirect(`/orders/${order.id}`);
}
