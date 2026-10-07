"use client";

import { useFormStatus } from "react-dom";

export function OrderButton() {
	const { pending } = useFormStatus();

	return (
		<button
			type="submit"
			disabled={pending}
			className="w-full cursor-pointer rounded-xl bg-gray-900 py-4 text-base font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{pending ? "Creating order…" : "Checkout"}
		</button>
	);
}
