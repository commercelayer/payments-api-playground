import { deleteGiftCard } from "@/actions/delete-gift-card";
import { getIntegrationClient } from "@/lib/client";
import { currencySymbol } from "@/lib/format";
import { GiftCardForm } from "./gift-card-form";

const STATUS_STYLES: Record<string, string> = {
	draft: "bg-gray-100 text-gray-500",
	inactive: "bg-yellow-100 text-yellow-700",
	active: "bg-green-100 text-green-700",
	redeemed: "bg-purple-100 text-purple-700",
};

export async function GiftCardDebug({ orderId }: { orderId: string }) {
	let currencyCode: string | null | undefined;
	let giftCards: Awaited<ReturnType<typeof fetchGiftCards>> | null = null;

	try {
		const client = await getIntegrationClient();
		// A gift card only applies to an order in its own currency, so the panel
		// lists and creates cards in the order's currency.
		({ currency_code: currencyCode } = await client.orders.retrieve(orderId, {
			fields: { orders: ["currency_code"] },
		}));
		if (!currencyCode) return null;
		giftCards = await fetchGiftCards(client, currencyCode);
	} catch {
		return null;
	}

	return (
		<section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50">
			<div className="border-b border-amber-200 px-6 py-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
					Debug — Gift Cards
				</p>
			</div>

			{giftCards && giftCards.length > 0 ? (
				<ul className="divide-y divide-amber-100">
					{giftCards.map((gc) => {
						const statusStyle =
							STATUS_STYLES[gc.status ?? "draft"] ?? STATUS_STYLES.draft;
						return (
							<li
								key={gc.id}
								className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
							>
								<span className="font-mono text-xs text-amber-800">
									{gc.code}
								</span>
								<div className="flex items-center gap-3">
									<span className="text-sm font-medium text-amber-900">
										{gc.formatted_balance}
									</span>
									<span
										className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle}`}
									>
										{gc.status ?? "draft"}
									</span>
									<form action={deleteGiftCard.bind(null, orderId)}>
										<input type="hidden" name="id" value={gc.id} />
										<button
											type="submit"
											className="cursor-pointer text-xs text-amber-500 hover:text-red-500"
										>
											Delete
										</button>
									</form>
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="px-6 py-4 text-sm text-amber-600">No gift cards yet.</p>
			)}

			<div className="border-t border-amber-200">
				<GiftCardForm
					orderId={orderId}
					currencySymbol={currencySymbol(currencyCode)}
				/>
			</div>
		</section>
	);
}

async function fetchGiftCards(
	client: Awaited<ReturnType<typeof getIntegrationClient>>,
	currencyCode: string,
) {
	return client.gift_cards.list({
		filters: { currency_code_eq: currencyCode, balance_cents_gt: "0" },
		fields: {
			gift_cards: ["code", "status", "formatted_balance", "currency_code"],
		},
		sort: { created_at: "desc" },
	});
}
