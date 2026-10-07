import { getIntegrationClient } from "@/lib/client";
import { formatAmount } from "@/lib/format";
import { TRANSACTION_STATUS_STYLES } from "@/lib/payment-labels";
import { DebugClickableId } from "./debug-clickable-id";
import { PaymentSessionsDebugRefresh } from "./payment-sessions-debug-refresh";

function StatusBadge({ status }: { status: string | null | undefined }) {
	if (!status) return null;
	const style =
		TRANSACTION_STATUS_STYLES[status] ?? "bg-gray-100 text-gray-500";
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}
		>
			{status}
		</span>
	);
}

export async function PaymentSessionsDebug({ orderId }: { orderId: string }) {
	let sessions: NonNullable<Awaited<ReturnType<typeof fetchSessions>>>;

	try {
		const client = await getIntegrationClient();
		sessions = await fetchSessions(client, orderId);
	} catch {
		return null;
	}

	return (
		<section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50">
			<div className="flex items-center justify-between border-b border-amber-200 px-6 py-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
					Debug — Payment Sessions
				</p>
				<PaymentSessionsDebugRefresh />
			</div>

			{sessions.length === 0 ? (
				<p className="px-6 py-4 text-xs text-amber-500">
					No payment sessions yet
				</p>
			) : (
				<ul className="flex flex-col gap-2 px-4 py-3">
					{sessions.map((s) => {
						const isGiftCard =
							s.payment_setting?.type === "payment_setting_gift_cards";
						const auth = s.payment_authorization ?? null;
						const pVoid = s.payment_void ?? null;
						const captures = s.payment_captures ?? [];
						const refunds = s.payment_refunds ?? [];

						return (
							<li key={s.id} className="flex flex-col gap-0.5">
								{/* Session row */}
								<div className="flex flex-wrap items-center gap-2">
									<span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-800">
										{isGiftCard
											? "gift_card"
											: (s.payment_setting?.name ??
												s.payment_setting?.type ??
												"unknown")}
									</span>
									<DebugClickableId id={s.id} data={s} />
									<StatusBadge status={s.status} />
									{isGiftCard && s.gift_card_code && (
										<span className="font-mono text-xs text-amber-700">
											Code: {s.gift_card_code}
										</span>
									)}
									{s.amount_cents != null && s.currency_code && (
										<span className="text-xs text-amber-700">
											{formatAmount(s.amount_cents, s.currency_code)}
										</span>
									)}
								</div>

								{/* Auth row */}
								{auth && (
									<div className="ml-4 flex flex-wrap items-center gap-2 border-l-2 border-amber-200 pl-3">
										<span className="text-xs text-amber-600">auth</span>
										<StatusBadge status={auth.status} />
										<span className="font-mono text-xs text-amber-600/70">
											{auth.id}
										</span>
										{auth.amount_cents != null && auth.currency_code && (
											<span className="text-xs text-amber-700">
												{formatAmount(auth.amount_cents, auth.currency_code)}
											</span>
										)}
									</div>
								)}

								{/* Void row */}
								{pVoid && (
									<div className="ml-4 flex flex-wrap items-center gap-2 border-l-2 border-amber-200 pl-3">
										<span className="text-xs text-amber-600">void</span>
										<StatusBadge status={pVoid.status} />
										<span className="font-mono text-xs text-amber-600/70">
											{pVoid.id}
										</span>
										{pVoid.amount_cents != null && pVoid.currency_code && (
											<span className="text-xs text-amber-700">
												{formatAmount(pVoid.amount_cents, pVoid.currency_code)}
											</span>
										)}
									</div>
								)}

								{/* Capture rows */}
								{captures.map((cap) => (
									<div
										key={cap.id}
										className="ml-4 flex flex-wrap items-center gap-2 border-l-2 border-amber-200 pl-3"
									>
										<span className="text-xs text-amber-600">capture</span>
										<StatusBadge status={cap.status} />
										<span className="font-mono text-xs text-amber-600/70">
											{cap.id}
										</span>
										{cap.amount_cents != null && cap.currency_code && (
											<span className="text-xs text-amber-700">
												{formatAmount(cap.amount_cents, cap.currency_code)}
											</span>
										)}
									</div>
								))}

								{/* Refund rows */}
								{refunds.map((ref) => (
									<div
										key={ref.id}
										className="ml-4 flex flex-wrap items-center gap-2 border-l-2 border-amber-200 pl-3"
									>
										<span className="text-xs text-amber-600">refund</span>
										<StatusBadge status={ref.status} />
										<span className="font-mono text-xs text-amber-600/70">
											{ref.id}
										</span>
										{ref.amount_cents != null && ref.currency_code && (
											<span className="text-xs text-amber-700">
												{formatAmount(ref.amount_cents, ref.currency_code)}
											</span>
										)}
									</div>
								))}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

async function fetchSessions(
	client: Awaited<ReturnType<typeof getIntegrationClient>>,
	orderId: string,
) {
	const order = await client.orders.retrieve(orderId, {
		include: [
			"payment_sessions.payment_setting",
			"payment_sessions.payment_authorization",
			"payment_sessions.payment_void",
			"payment_sessions.payment_captures",
			"payment_sessions.payment_refunds",
		],
	});
	return order.payment_sessions ?? [];
}
