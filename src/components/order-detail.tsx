"use client";

import type { Order } from "@commercelayer/sdk";
import Link from "next/link";
import {
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { createClient } from "@/lib/create-client";
import { orderFrequency } from "@/lib/subscriptions";
import { customerIdFromToken } from "@/lib/token";
import { PaymentSection } from "./payment-section";
import { ShipmentSection } from "./shipment-section";
import { SubscriptionSection } from "./subscription-section";

const PLACED_STATUSES = ["placed", "approved", "cancelled"];

const STATUS_STYLES: Record<string, string> = {
	draft: "bg-gray-100 text-gray-600",
	pending: "bg-yellow-100 text-yellow-700",
	editing: "bg-blue-100 text-blue-700",
	placing: "bg-blue-100 text-blue-700",
	placed: "bg-blue-100 text-blue-700",
	approved: "bg-green-100 text-green-700",
	cancelled: "bg-red-100 text-red-600",
};

type Props = {
	orderId: string;
	accessToken: string;
};

export function OrderDetail({ orderId, accessToken }: Props) {
	const client = useMemo(() => createClient(accessToken), [accessToken]);
	const isCustomer = useMemo(
		() => customerIdFromToken(accessToken) != null,
		[accessToken],
	);

	const [order, setOrder] = useState<Order | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const orderInclude = useMemo<string[]>(
		() => [
			"line_items",
			"shipping_address",
			"billing_address",
			"shipments.available_shipping_methods",
			"shipments.shipping_method",
			"market",
			"available_payment_settings",
			// "available_payment_methods",
			"payment_sessions.payment_setting",
			"payment_sessions.payment_authorization.payment_void",
			"payment_sessions.payment_captures",
			"payment_sessions.payment_refunds",
			"order_subscriptions",
			"order_subscriptions.payment_setting",
			"order_subscriptions.payment_wallet",
		],
		[],
	);

	const fetchOrder = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setOrder(
				await client.orders.retrieve(orderId, { include: orderInclude }),
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load order.");
		} finally {
			setLoading(false);
		}
	}, [client, orderId, orderInclude]);

	const refreshOrder = useCallback(async () => {
		try {
			setOrder(
				await client.orders.retrieve(orderId, { include: orderInclude }),
			);
		} catch {
			// silently ignore — the stale data stays visible
		}
	}, [client, orderId, orderInclude]);

	const handleQuantityChange = useCallback(
		async (itemId: string, quantity: number) => {
			await client.line_items.update({ id: itemId, quantity });
			await refreshOrder();
		},
		[client, refreshOrder],
	);

	useEffect(() => {
		fetchOrder();
	}, [fetchOrder]);

	if (loading) {
		return (
			<div className="flex flex-col gap-6">
				<Link
					href="/"
					className="text-sm text-gray-500 hover:text-gray-900 hover:underline"
				>
					← Back
				</Link>
				<div className="flex items-center gap-3 text-sm text-gray-400">
					<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
					Loading order…
				</div>
			</div>
		);
	}

	if (error || !order) {
		return (
			<div className="flex flex-col gap-6">
				<Link
					href="/"
					className="text-sm text-gray-500 hover:text-gray-900 hover:underline"
				>
					← Back
				</Link>
				<div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
					{error ?? "Order not found."}
				</div>
			</div>
		);
	}

	// Every shipment needs a method before payment makes sense: a line item write
	// rebuilds the shipments and clears it, and until one is picked the order
	// total is missing the shipping cost. An order with no shipments at all (a
	// digital, do_not_ship SKU) is ready by definition.
	const shippingReady = (order.shipments ?? []).every(
		(shipment) => shipment.shipping_method != null,
	);

	const statusStyle =
		STATUS_STYLES[order.status ?? "draft"] ?? STATUS_STYLES.draft;

	return (
		<div className="flex flex-col gap-6">
			<div>
				<Link
					href="/"
					className="text-sm text-gray-500 hover:text-gray-900 hover:underline"
				>
					← Back
				</Link>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold">
						Order #{order.number ?? order.id}
					</h1>
					<p className="mt-0.5 font-mono text-xs text-gray-400">{order.id}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${statusStyle}`}
					>
						{order.status ?? "draft"}
					</span>
					<span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium capitalize text-gray-600">
						{order.payment_status ?? "unpaid"}
					</span>
					<span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium capitalize text-gray-600">
						{order.fulfillment_status ?? "unfulfilled"}
					</span>
				</div>
			</div>

			{/* Line items */}
			<section className="rounded-2xl border border-gray-200 bg-white">
				<div className="border-b border-gray-100 px-6 py-4">
					<h2 className="font-semibold">Items</h2>
				</div>
				<ul className="divide-y divide-gray-100">
					{(order.line_items ?? []).map((item) => (
						<li key={item.id} className="flex items-center gap-4 px-6 py-4">
							{item.image_url ? (
								// biome-ignore lint/performance/noImgElement: intentional for simplicity
								<img
									src={item.image_url}
									alt={item.name ?? item.sku_code ?? ""}
									className="h-12 w-12 shrink-0 rounded-lg object-cover"
								/>
							) : (
								<div className="h-12 w-12 shrink-0 rounded-lg bg-gray-100" />
							)}
							<div className="flex flex-1 flex-wrap items-center justify-between gap-2">
								<div>
									<p className="font-medium">
										{item.name ?? item.sku_code ?? "—"}
									</p>
									{item.sku_code && (
										<p className="mt-0.5 font-mono text-xs text-gray-400">
											{item.sku_code}
										</p>
									)}
								</div>
								<div className="flex items-center gap-4">
									{item.sku_code ? (
										<LineItemQuantity
											quantity={item.quantity ?? 1}
											disabled={PLACED_STATUSES.includes(order.status ?? "")}
											onChange={(qty) => handleQuantityChange(item.id, qty)}
										/>
									) : (
										<span className="text-sm text-gray-500">
											qty {item.quantity}
										</span>
									)}
									<p className="w-20 text-right font-medium">
										{item.formatted_total_amount ?? "—"}
									</p>
								</div>
							</div>
						</li>
					))}
				</ul>
				<div className="space-y-1 border-t border-gray-100 px-6 py-4 text-sm">
					<div className="flex justify-between text-gray-600">
						<span>Subtotal</span>
						<span>{order.formatted_subtotal_amount ?? "—"}</span>
					</div>
					<div className="flex justify-between text-gray-600">
						<span>Shipping</span>
						<span>{order.formatted_shipping_amount ?? "—"}</span>
					</div>
					<div className="flex justify-between pt-2 text-base font-semibold">
						<span>Total</span>
						<span>
							{order.formatted_total_amount_with_taxes ??
								order.formatted_total_amount ??
								"—"}
						</span>
					</div>
				</div>
			</section>

			{/* Addresses */}
			<div className="grid gap-4 sm:grid-cols-2">
				{order.shipping_address && (
					<section className="rounded-2xl border border-gray-200 bg-white p-6">
						<h2 className="mb-3 font-semibold">Shipping address</h2>
						<AddressBlock address={order.shipping_address} />
					</section>
				)}
				{order.billing_address && (
					<section className="rounded-2xl border border-gray-200 bg-white p-6">
						<h2 className="mb-3 font-semibold">Billing address</h2>
						<AddressBlock address={order.billing_address} />
					</section>
				)}
			</div>

			{/* Shipments */}
			{/* Refreshed in place rather than re-fetched: `fetchOrder` raises the
			    loading state, which swaps the whole page for the spinner and
			    unmounts PaymentSection — losing the total it compares against to
			    notice the re-price and rebuild its sessions. */}
			<ShipmentSection
				accessToken={accessToken}
				shipments={order.shipments ?? []}
				orderStatus={order.status ?? "draft"}
				onShippingMethodChanged={refreshOrder}
			/>

			{/* Customer */}
			<section className="rounded-2xl border border-gray-200 bg-white p-6">
				<h2 className="mb-2 font-semibold">Customer</h2>
				<p className="text-sm text-gray-600">{order.customer_email ?? "—"}</p>
			</section>

			{/* Subscription */}
			<SubscriptionSection
				order={order}
				accessToken={accessToken}
				isCustomer={isCustomer}
				onFrequencyChanged={refreshOrder}
			/>

			{/* Payment */}
			<Suspense>
				<PaymentSection
					orderId={orderId}
					orderStatus={order.status ?? "draft"}
					orderTotalAmountCents={
						order.total_amount_with_taxes_cents ?? order.total_amount_cents ?? 0
					}
					orderCurrencyCode={order.currency_code ?? ""}
					customerEmail={order.customer_email}
					billingAddress={order.billing_address}
					accessToken={accessToken}
					availablePaymentSettings={order.available_payment_settings ?? []}
					paymentSessions={order.payment_sessions ?? []}
					// Gated on the customer too, matching the section above: a
					// frequency left on the line items from an earlier logged-in
					// visit would otherwise mint a subscription on checkout that
					// this guest can neither see nor cancel.
					createSubscriptions={isCustomer && orderFrequency(order) != null}
					shippingReady={shippingReady}
					onOrderPlaced={fetchOrder}
					onGiftCardApplied={refreshOrder}
				/>
			</Suspense>
		</div>
	);
}

function LineItemQuantity({
	quantity,
	disabled,
	onChange,
}: {
	quantity: number;
	disabled: boolean;
	onChange: (qty: number) => Promise<void>;
}) {
	const [saving, setSaving] = useState(false);

	async function handle(next: number) {
		if (next < 1 || saving) return;
		setSaving(true);
		try {
			await onChange(next);
		} finally {
			setSaving(false);
		}
	}

	const btn = (label: ReactNode, next: number) => (
		<button
			type="button"
			onClick={() => handle(next)}
			disabled={disabled || saving || next < 1}
			className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-sm text-gray-600 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
		>
			{label}
		</button>
	);

	return (
		<div className="flex items-center gap-1.5">
			{btn("−", quantity - 1)}
			<span
				className={`w-6 text-center text-sm font-medium tabular-nums ${saving ? "opacity-40" : ""}`}
			>
				{quantity}
			</span>
			{btn("+", quantity + 1)}
		</div>
	);
}

function AddressBlock({
	address,
}: {
	address: {
		full_name?: string | null;
		first_name?: string | null;
		last_name?: string | null;
		line_1: string;
		line_2?: string | null;
		city: string;
		zip_code?: string | null;
		state_code?: string | null;
		country_code: string;
		phone?: string | null;
	};
}) {
	const name =
		address.full_name ??
		[address.first_name, address.last_name].filter(Boolean).join(" ") ??
		"—";

	return (
		<address className="not-italic text-sm text-gray-600 leading-relaxed">
			<p className="font-medium text-gray-900">{name}</p>
			<p>{address.line_1}</p>
			{address.line_2 && <p>{address.line_2}</p>}
			<p>
				{[address.zip_code, address.city, address.state_code]
					.filter(Boolean)
					.join(", ")}
			</p>
			<p>{address.country_code}</p>
			{address.phone && <p className="mt-1">{address.phone}</p>}
		</address>
	);
}
