import type { PaymentSetting } from "@commercelayer/sdk";
import { labelForType } from "@/lib/payment-labels";

/**
 * Method selector + amount, shared by all payment methods. The amount row is
 * shown only before a session is pending; what follows (Confirm, the card
 * form) belongs to the chosen gateway's module.
 */
export function PaymentMethodPicker({
	paymentMethodSettings,
	selectedSettingId,
	onMethodChange,
	amountInput,
	onAmountChange,
	orderCurrencyCode,
	remainingPaymentAmountCents,
	hasPendingSession,
}: {
	paymentMethodSettings: PaymentSetting[];
	selectedSettingId: string;
	onMethodChange: (settingId: string) => void;
	amountInput: string;
	onAmountChange: (value: string) => void;
	orderCurrencyCode: string;
	remainingPaymentAmountCents: number;
	hasPendingSession: boolean;
}) {
	return (
		<>
			{/* Method selector */}
			{paymentMethodSettings.length === 0 ? (
				<p className="text-sm text-gray-400">No payment methods available.</p>
			) : (
				<ul className="mb-3 flex flex-col gap-2">
					{paymentMethodSettings.map((setting) => (
						<li key={setting.id}>
							<label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 has-[:checked]:border-gray-900 has-[:checked]:bg-gray-50">
								<input
									type="radio"
									name="payment_method"
									value={setting.id}
									checked={selectedSettingId === setting.id}
									onChange={() => onMethodChange(setting.id)}
									className="accent-gray-900"
								/>
								<span className="text-sm font-medium">
									{setting.name ?? labelForType(setting.type)}
								</span>
								<span className="ml-auto font-mono text-xs text-gray-400">
									{setting.type}
								</span>
							</label>
						</li>
					))}
				</ul>
			)}

			{/* Amount input — shown once a method is selected and no pending session */}
			{selectedSettingId && !hasPendingSession && (
				<div className="flex flex-col gap-2">
					<div className="flex gap-2">
						<input
							type="number"
							value={amountInput}
							onChange={(e) => onAmountChange(e.target.value)}
							min="0.01"
							step="0.01"
							max={(remainingPaymentAmountCents / 100).toFixed(2)}
							placeholder="Amount"
							className="w-36 rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-gray-400"
						/>
						<span className="flex items-center text-sm text-gray-500">
							{orderCurrencyCode.toUpperCase()}
						</span>
					</div>
				</div>
			)}
		</>
	);
}
