export function formatAmount(cents: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency,
	}).format(cents / 100);
}

export function currencySymbol(currency: string): string {
	const parts = new Intl.NumberFormat(undefined, {
		style: "currency",
		currency,
	}).formatToParts(0);
	return parts.find((part) => part.type === "currency")?.value ?? currency;
}
