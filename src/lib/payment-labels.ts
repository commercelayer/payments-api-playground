import type { PaymentWallet } from "@commercelayer/sdk";

export function labelForType(type: string): string {
	switch (type) {
		case "payment_setting_manuals":
			return "Manual payment";
		case "payment_setting_stripes":
			return "Credit card";
		case "payment_setting_adyens":
			return "Adyen";
		case "payment_setting_externals":
			return "External payment";
		case "payment_setting_braintrees":
			return "Braintree";
		default:
			return type;
	}
}

export const TRANSACTION_STATUS_STYLES: Record<string, string> = {
	authorized: "bg-blue-100 text-blue-700",
	succeeded: "bg-green-100 text-green-700",
	declined: "bg-red-100 text-red-600",
	failed: "bg-red-100 text-red-600",
	processing: "bg-yellow-100 text-yellow-700",
	voided: "bg-gray-100 text-gray-500",
	draft: "bg-gray-100 text-gray-500",
};

/** Format an expiry as MM/YY, or "" when either part is missing. */
function fmtExp(month: unknown, year: unknown): string {
	if (!month || !year) return "";
	return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/**
 * Normalize card display data across gateways — `payment_data` differs by gateway:
 *  - Stripe: `{ card: { brand, last4, exp_month, exp_year } }`
 *  - Adyen (event):  `{ paymentMethod, additionalData: { cardSummary, expiryDate: "MM/YYYY" } }`
 *  - Adyen (stored): `{ brand, lastFour, expiryMonth, expiryYear }`
 */
export function cardDisplay(wallet: PaymentWallet): {
	brand: string;
	last4: string;
	exp: string;
} {
	// biome-ignore lint/suspicious/noExplicitAny: gateway-specific payment_data
	const pd = (wallet.payment_data ?? {}) as Record<string, any>;

	// Stripe
	if (pd.card) {
		return {
			brand: String(pd.card.brand ?? "").toUpperCase(),
			last4: String(pd.card.last4 ?? ""),
			exp: fmtExp(pd.card.exp_month, pd.card.exp_year),
		};
	}

	// Adyen — event shape or stored-payment-method shape
	const ad = (pd.additionalData ?? {}) as Record<string, unknown>;
	const brand = String(pd.brand ?? pd.paymentMethod ?? "").toUpperCase();
	const last4 = String(pd.lastFour ?? ad.cardSummary ?? "");
	let month = pd.expiryMonth;
	let year = pd.expiryYear;
	if ((!month || !year) && typeof ad.expiryDate === "string") {
		[month, year] = ad.expiryDate.split("/");
	}
	return { brand, last4, exp: fmtExp(month, year) };
}

/** A one-line card label, e.g. "VISA •••• 4242". */
export function cardLabel(wallet: PaymentWallet): string {
	const { brand, last4 } = cardDisplay(wallet);
	if (!brand && !last4) return wallet.payment_token ?? wallet.id;
	return `${brand} •••• ${last4}`.trim();
}
