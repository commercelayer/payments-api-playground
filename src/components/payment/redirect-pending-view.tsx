/**
 * Spinner shown while the customer returns from an off-site redirect (Amazon
 * Pay through Stripe, Mollie, an Adyen 3-D Secure redirect) and the
 * redirect-return effect completes the payment and places the order.
 */
export function RedirectPendingView({
	placeError,
}: {
	placeError: string | null;
}) {
	return (
		<section className="rounded-2xl border border-gray-200 bg-white">
			<div className="border-b border-gray-100 px-6 py-4">
				<h2 className="font-semibold">Payment</h2>
			</div>
			<div className="px-6 py-5">
				{placeError ? (
					<p className="text-sm text-red-500">{placeError}</p>
				) : (
					<div className="flex items-center gap-2 text-sm text-gray-500">
						<span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
						Completing your payment…
					</div>
				)}
			</div>
		</section>
	);
}
