import { formatAmount } from "@/lib/format";
import { TRANSACTION_STATUS_STYLES } from "@/lib/payment-labels";

export function TransactionRow({
	label,
	id,
	status,
	amountCents,
	currency,
	indent = false,
	prefix,
}: {
	label: string;
	id: string;
	status: string;
	amountCents?: number | null;
	currency?: string | null;
	indent?: boolean;
	prefix?: string;
}) {
	return (
		<div
			className={`flex flex-wrap items-center gap-2 ${indent ? "ml-4 border-l-2 border-gray-100 pl-3" : ""}`}
		>
			<span className="w-24 shrink-0 text-xs font-medium text-gray-500">
				{label}
			</span>
			<TransactionStatusBadge status={status} />
			{amountCents != null && currency && (
				<span className="text-xs tabular-nums text-gray-700">
					{prefix}
					{formatAmount(amountCents, currency)}
				</span>
			)}
			<span className="font-mono text-xs text-gray-300">{id}</span>
		</div>
	);
}

export function TransactionStatusBadge({ status }: { status: string }) {
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
