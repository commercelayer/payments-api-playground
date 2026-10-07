"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createGiftCard } from "@/actions/create-gift-card";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomCode() {
	return Array.from(
		{ length: 10 },
		() => CHARS[Math.floor(Math.random() * CHARS.length)],
	).join("");
}

type Props = {
	orderId: string;
	currencySymbol: string;
};

export function GiftCardForm({ orderId, currencySymbol }: Props) {
	const [code, setCode] = useState(() => randomCode());
	const [state, action] = useActionState(createGiftCard.bind(null, orderId), {
		error: null,
		success: false,
	});

	useEffect(() => {
		if (state.success) setCode(randomCode());
	}, [state.success]);

	return (
		<form action={action} className="flex flex-wrap items-end gap-3 px-6 py-4">
			<div className="flex flex-col gap-1">
				{/** biome-ignore lint/a11y/noLabelWithoutControl: this is a demo */}
				<label className="text-xs font-medium text-amber-700">Code</label>
				<input
					type="text"
					name="code"
					value={code}
					onChange={(e) => setCode(e.target.value.toUpperCase())}
					required
					className="rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-amber-900 outline-none focus:border-amber-400"
				/>
			</div>

			<div className="flex flex-col gap-1">
				{/** biome-ignore lint/a11y/noLabelWithoutControl: this is a demo */}
				<label className="text-xs font-medium text-amber-700">
					Amount ({currencySymbol})
				</label>
				<input
					type="number"
					name="amount"
					min={1}
					step={1}
					placeholder="100"
					required
					className="w-28 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900 outline-none focus:border-amber-400"
				/>
			</div>

			<SubmitButton />

			{state.error && (
				<p className="w-full text-xs text-red-600">{state.error}</p>
			)}
		</form>
	);
}

function SubmitButton() {
	const { pending } = useFormStatus();
	return (
		<button
			type="submit"
			disabled={pending}
			className="cursor-pointer rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{pending ? "Creating…" : "Create"}
		</button>
	);
}
