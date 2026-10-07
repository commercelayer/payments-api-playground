import type { PaymentSetting, PaymentWallet } from "@commercelayer/sdk";
import { cardDisplay } from "@/lib/payment-labels";

/** Human gateway name + badge colours, from the payment_setting type. */
function gatewayBadge(type: string | undefined): {
	label: string;
	className: string;
} | null {
	switch (type) {
		case "payment_setting_stripes":
			return { label: "Stripe", className: "bg-indigo-100 text-indigo-700" };
		case "payment_setting_adyens":
			return { label: "Adyen", className: "bg-emerald-100 text-emerald-700" };
		default:
			return null;
	}
}

/**
 * One-click "Saved cards" list (scenario 7) — succeeded payment_wallets for the
 * logged-in customer. Each row shows the card, a gateway badge (resolved from the
 * wallet's payment_setting), a Pay button (reuse the stored token), and Remove
 * (delete the CL payment_wallet).
 */
export function SavedCardsSection({
	paymentWallets,
	availablePaymentSettings,
	payingWithWalletId,
	deletingWalletId,
	walletError,
	onPay,
	onDelete,
}: {
	paymentWallets: PaymentWallet[];
	availablePaymentSettings: PaymentSetting[];
	payingWithWalletId: string | null;
	deletingWalletId: string | null;
	walletError: string | null;
	onPay: (wallet: PaymentWallet) => void;
	onDelete: (wallet: PaymentWallet) => void;
}) {
	const busy = !!payingWithWalletId || !!deletingWalletId;
	return (
		<div className="px-6 py-5">
			<p className="mb-3 text-sm font-medium text-gray-700">Saved cards</p>
			<ul className="flex flex-col gap-2">
				{paymentWallets.map((wallet) => {
					const { brand, last4, exp } = cardDisplay(wallet);
					// The included payment_setting resolves to the base type, so derive
					// the gateway by matching the setting id against the market's settings.
					const setting = availablePaymentSettings.find(
						(s) => s.id === wallet.payment_setting?.id,
					);
					const badge = gatewayBadge(setting?.type);
					const paying = payingWithWalletId === wallet.id;
					const deleting = deletingWalletId === wallet.id;
					return (
						<li
							key={wallet.id}
							className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"
						>
							<span className="text-sm font-medium">
								{brand} •••• {last4}
							</span>
							{badge && (
								<span
									className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}
								>
									{badge.label}
								</span>
							)}
							{exp && (
								<span className="ml-auto font-mono text-xs text-gray-400">
									{exp}
								</span>
							)}
							<button
								type="button"
								onClick={() => onPay(wallet)}
								disabled={busy}
								className={`${exp ? "" : "ml-auto"} cursor-pointer rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50`}
							>
								{paying ? "Paying…" : "Pay"}
							</button>
							<button
								type="button"
								onClick={() => onDelete(wallet)}
								disabled={busy}
								aria-label="Remove saved card"
								className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{deleting ? "Removing…" : "Remove"}
							</button>
						</li>
					);
				})}
			</ul>
			{walletError && (
				<p className="mt-2 text-xs text-red-500">{walletError}</p>
			)}
		</div>
	);
}
