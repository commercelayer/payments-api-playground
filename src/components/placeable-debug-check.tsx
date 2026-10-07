"use client";

import { useState } from "react";
import { createClient } from "@/lib/create-client";

export function PlaceableDebugCheck({
	orderId,
	accessToken,
}: {
	orderId: string;
	accessToken: string;
}) {
	const [result, setResult] = useState<
		| { type: "success"; value: boolean }
		| { type: "error"; message: string }
		| null
	>(null);

	async function handleCheck() {
		setResult(null);
		const client = createClient(accessToken);
		try {
			const order = await client.orders._placeable(orderId);
			setResult({ type: "success", value: order.placeable ?? false });
		} catch (e) {
			setResult({ type: "error", message: JSON.stringify(e, null, 2) });
		}
	}

	return (
		<>
			<div className="flex items-center justify-between border-b border-amber-200 px-6 py-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
					Debug — Placeable
				</p>
				<button
					type="button"
					onClick={handleCheck}
					className="cursor-pointer rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-200"
				>
					Check _placeable
				</button>
			</div>
			<div className="px-6 py-4">
				{result === null ? (
					<p className="text-xs text-amber-500">
						Press the button to check if the order is placeable.
					</p>
				) : result.type === "success" ? (
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${
							result.value
								? "bg-green-100 text-green-700"
								: "bg-red-100 text-red-600"
						}`}
					>
						placeable: {String(result.value)}
					</span>
				) : (
					<pre className="whitespace-pre-wrap break-all font-mono text-xs text-red-600">
						{result.message}
					</pre>
				)}
			</div>
		</>
	);
}
