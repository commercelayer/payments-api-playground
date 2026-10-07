import type { PaymentSession } from "@commercelayer/sdk";
import { formatAmount } from "@/lib/format";

/**
 * Gift card entry + applied-gift-card list. Gift cards reduce the remaining
 * balance immediately on apply; their authorization happens at place-order time.
 *
 * The covered/remaining counter is shown as soon as anything covers part of the
 * order, because a gift card is only worth its actual balance: asking for the
 * full remaining balance can still come back partially covered, and the counter
 * is what makes that visible. Once nothing is left to pay, the entry closes —
 * removing an applied card stays available and reopens it.
 */
export function GiftCardSection({
	appliedGiftCards,
	giftCardInput,
	onGiftCardInputChange,
	applying,
	applyError,
	droppedGiftCards,
	removingId,
	canRemove,
	canApply,
	coveredAmountCents,
	remainingAmountCents,
	orderTotalAmountCents,
	currencyCode,
	onApply,
	onRemove,
}: {
	appliedGiftCards: PaymentSession[];
	giftCardInput: string;
	onGiftCardInputChange: (value: string) => void;
	applying: boolean;
	applyError: string | null;
	droppedGiftCards: string[];
	removingId: string | null;
	canRemove: boolean;
	canApply: boolean;
	coveredAmountCents: number;
	remainingAmountCents: number;
	orderTotalAmountCents: number;
	currencyCode: string;
	onApply: () => void;
	onRemove: (sessionId: string) => void;
}) {
	return (
		<div className="px-6 py-5">
			<p className="mb-3 text-sm font-medium text-gray-700">
				Gift cards
				<span className="ml-1.5 text-xs font-normal text-gray-400">
					optional
				</span>
			</p>

			{appliedGiftCards.length > 0 && (
				<ul className="mb-3 flex flex-col gap-1.5">
					{appliedGiftCards.map((s) => (
						<li
							key={s.id}
							className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2"
						>
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
							<span className="flex-1 font-mono text-sm text-green-800">
								{s.gift_card_code}
							</span>
							{s.amount_cents != null && s.currency_code && (
								<span className="text-sm text-green-700">
									{formatAmount(s.amount_cents, s.currency_code)}
								</span>
							)}
							{canRemove && (
								<button
									type="button"
									onClick={() => onRemove(s.id)}
									disabled={removingId === s.id}
									className="cursor-pointer text-xs text-green-600 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{removingId === s.id ? "Removing…" : "Remove"}
								</button>
							)}
						</li>
					))}
				</ul>
			)}

			{coveredAmountCents > 0 && currencyCode && (
				<p className="mb-3 text-xs text-gray-500">
					Covered {formatAmount(coveredAmountCents, currencyCode)} of{" "}
					{formatAmount(orderTotalAmountCents, currencyCode)}
					<span className="mx-1.5 text-gray-300">·</span>
					{remainingAmountCents > 0 ? (
						<span className="font-medium text-gray-700">
							{formatAmount(remainingAmountCents, currencyCode)} left
						</span>
					) : (
						<span className="font-medium text-green-700">
							nothing left to pay
						</span>
					)}
				</p>
			)}

			{droppedGiftCards.length > 0 && (
				<p className="mb-3 text-xs text-amber-600">
					Couldn't re-apply after the order total changed:{" "}
					<span className="font-mono">{droppedGiftCards.join(", ")}</span>. Add
					them again.
				</p>
			)}

			<div className="flex gap-2">
				<input
					type="text"
					value={giftCardInput}
					onChange={(e) => onGiftCardInputChange(e.target.value)}
					// Deliberately constant: the counter above already says why the
					// entry is closed, and a placeholder that changes with state is a
					// brittle handle for tests and screen readers alike.
					placeholder="Gift card code"
					disabled={applying || !canApply}
					className="flex-1 rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={onApply}
					disabled={applying || !canApply || !giftCardInput.trim()}
					className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{applying ? "Applying…" : "Apply"}
				</button>
			</div>

			{applyError && <p className="mt-2 text-xs text-red-500">{applyError}</p>}
		</div>
	);
}
