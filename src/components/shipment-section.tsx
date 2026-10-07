"use client";

import type { Shipment, ShippingMethod } from "@commercelayer/sdk";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/create-client";

type Props = {
	accessToken: string;
	shipments: Shipment[];
	orderStatus: string;
	onShippingMethodChanged: () => void;
};

const PLACED_STATUSES = ["placed", "approved", "cancelled"];

export function ShipmentSection({
	accessToken,
	shipments,
	orderStatus,
	onShippingMethodChanged,
}: Props) {
	const client = useMemo(() => createClient(accessToken), [accessToken]);

	const isPlaced = PLACED_STATUSES.includes(orderStatus);

	if (shipments.length === 0) return null;

	return (
		<section className="rounded-2xl border border-gray-200 bg-white">
			<div className="border-b border-gray-100 px-6 py-4">
				<h2 className="font-semibold">Shipments</h2>
			</div>
			<ul className="divide-y divide-gray-100">
				{shipments.map((shipment) => (
					<ShipmentItem
						key={shipment.id}
						shipment={shipment}
						isPlaced={isPlaced}
						onSelect={async (methodId) => {
							await client.shipments.update({
								id: shipment.id,
								shipping_method: client.shipping_methods.relationship(methodId),
							});
							onShippingMethodChanged();
						}}
					/>
				))}
			</ul>
		</section>
	);
}

function ShipmentItem({
	shipment,
	isPlaced,
	onSelect,
}: {
	shipment: Shipment;
	isPlaced: boolean;
	onSelect: (methodId: string) => Promise<void>;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const availableMethods: ShippingMethod[] =
		shipment.available_shipping_methods ?? [];
	const selectedId = shipment.shipping_method?.id ?? "";

	async function handleChange(methodId: string) {
		setSaving(true);
		setError(null);
		try {
			await onSelect(methodId);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Failed to update shipping method.",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<li className="px-6 py-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<p className="font-mono text-xs text-gray-500">{shipment.id}</p>
				<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
					{shipment.status ?? "pending"}
				</span>
			</div>

			{availableMethods.length === 0 ? (
				<p className="text-sm text-gray-400">No shipping methods available.</p>
			) : (
				<ul className="flex flex-col gap-2">
					{availableMethods.map((method) => (
						<li key={method.id}>
							<label
								className={`flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 has-[:checked]:border-gray-900 has-[:checked]:bg-gray-50 ${isPlaced || saving ? "pointer-events-none opacity-60" : ""}`}
							>
								<input
									type="radio"
									name={`shipping_method_${shipment.id}`}
									value={method.id}
									defaultChecked={method.id === selectedId}
									disabled={isPlaced || saving}
									onChange={() => handleChange(method.id)}
									className="accent-gray-900"
								/>
								<span className="flex-1 text-sm font-medium">
									{method.name ?? method.id}
								</span>
								{method.formatted_price_amount && (
									<span className="text-sm text-gray-500">
										{method.formatted_price_amount}
									</span>
								)}
							</label>
						</li>
					))}
				</ul>
			)}

			{error && <p className="mt-2 text-xs text-red-500">{error}</p>}
		</li>
	);
}
