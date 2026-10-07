"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function PaymentSessionsDebugRefresh() {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	return (
		<button
			type="button"
			onClick={() => startTransition(() => router.refresh())}
			disabled={isPending}
			className="cursor-pointer rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{isPending ? "Refreshing…" : "Refresh"}
		</button>
	);
}
