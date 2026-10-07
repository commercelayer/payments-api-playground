import { createOrder } from "@/actions/create-order";
import { loginCustomer, logoutCustomer } from "@/actions/customer-auth";
import { OrderButton } from "@/components/order-button";
import { AdyenExpressAdvanced } from "@/gateways/adyen/express-checkout";
import { ExpressCheckout } from "@/gateways/stripe/express-checkout";
import {
	getAuthOwnerType,
	type getClient,
	getClientWithToken,
	getIntegrationClient,
	hasIntegrationCredentials,
} from "@/lib/client";
import { CUSTOMER_EMAIL, ORDER_ADDRESS } from "@/lib/order-defaults";

/** Apple Pay merchant country (ISO 3166) for the advanced-flow express button.
 * Must match your Apple Pay merchant registration in the Adyen Customer Area. */
const EXPRESS_COUNTRY_CODE = process.env.CL_EXPRESS_COUNTRY_CODE ?? "US";
/** Apple Pay merchant identifier for advanced-flow merchant validation. The
 * Sessions flow gets this from the session; the advanced flow must supply it.
 * Copy the `merchantIdentifier` from the working Sessions-flow validation
 * request (or your Adyen Apple Pay settings). Both values belong to one Adyen
 * account, so there is no sensible default: without them the advanced-flow
 * express button is not rendered. */
const APPLE_PAY_MERCHANT_ID = process.env.CL_APPLE_PAY_MERCHANT_ID;
const APPLE_PAY_MERCHANT_NAME = process.env.CL_APPLE_PAY_MERCHANT_NAME;

/** The product the store page sells. `CL_SKU_CODE` picks it explicitly; when
 * unset we fall back to the first SKU priced in the market, so the playground
 * works against any organization without extra configuration. A SKU without a
 * price in the market can't be added to an order there, hence the price check. */
async function getSku(client: Awaited<ReturnType<typeof getClient>>) {
	const skuCode = process.env.CL_SKU_CODE;
	const skus = await client.skus.list({
		filters: skuCode ? { code_eq: skuCode } : undefined,
		include: ["prices"],
		fields: {
			skus: ["code", "name", "description", "image_url", "prices"],
			prices: ["amount_cents", "currency_code", "formatted_amount"],
		},
		pageSize: skuCode ? 1 : 25,
	});
	return skus.find((sku) => sku.prices?.[0]?.amount_cents) ?? null;
}

/** Lookup of an enabled payment setting (id + public key) needed to render an
 * express wallet button. There is no order yet, so we can't use the order's
 * `available_payment_settings`; we read the typed setting via the integration
 * client (server-side only — public_key is public anyway). Works for either
 * gateway so the same helper can back the Stripe and Adyen buttons.
 *
 * Narrowed to the market the express order will be created in. An organization
 * can hold several enabled settings for one gateway — swapping in a new gateway
 * account leaves the previous setting sitting next to its replacement — and only
 * the ones listed on the market are accepted on an order placed in it. Picking
 * org-wide can therefore hand the button a setting that still carries revoked
 * credentials: the gateway rejects the call with a 401 and the API then refuses
 * the session with "payment_setting - is not available for this order". */
async function getEnabledPaymentSetting(
	gateway: "stripe" | "adyen",
	marketCode: string,
): Promise<{ id: string; publicKey: string } | null> {
	try {
		const client = await getIntegrationClient();
		const [market] = await client.markets.list({
			filters: { code_eq: marketCode },
			pageSize: 1,
		});
		const marketSettingIds = new Set(market?.payment_setting_ids ?? []);

		const settings: Array<{ id: string; public_key?: string | null }> =
			gateway === "stripe"
				? await client.payment_setting_stripes.list({
						filters: { disabled_at_null: true },
					})
				: await client.payment_setting_adyens.list({
						filters: { disabled_at_null: true },
					});

		const setting = settings.find(
			(s) => marketSettingIds.has(s.id) && s.public_key,
		);
		if (!setting?.public_key) return null;
		return { id: setting.id, publicKey: setting.public_key };
	} catch (e) {
		console.error(`[home] ${gateway} setting lookup failed:`, e);
		return null;
	}
}

export default async function HomePage() {
	const { client, accessToken } = await getClientWithToken();
	const marketCode = process.env.CL_MARKET_CODE ?? "EU";
	const ownerType = await getAuthOwnerType();
	const isCustomer = ownerType === "customer";
	const canLogin = !!(
		process.env.CL_CUSTOMER_EMAIL && process.env.CL_CUSTOMER_PASSWORD
	);

	const [organization, sku, stripeSetting, adyenSetting] = await Promise.all([
		client.organization.retrieve({ fields: { organizations: ["name"] } }),
		getSku(client),
		getEnabledPaymentSetting("stripe", marketCode),
		getEnabledPaymentSetting("adyen", marketCode),
	]);
	const price = sku?.prices?.[0];

	const hasIntegration = hasIntegrationCredentials();

	const pageHeader = (
		<div>
			<h1 className="text-2xl font-bold">{organization.name}</h1>
			<p className="mt-1 text-sm text-gray-500">
				Payments API Playground — {marketCode} market
			</p>
			{!hasIntegration && (
				<p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
					Integration application credentials are not set (
					<span className="font-mono">CL_INTEGRATION_CLIENT_ID</span>,{" "}
					<span className="font-mono">CL_INTEGRATION_CLIENT_SECRET</span>):
					express payments, Adyen advanced-flow payments and the debug panels
					are off.
				</p>
			)}
		</div>
	);

	if (!sku?.code || !price?.amount_cents) {
		const configuredSkuCode = process.env.CL_SKU_CODE;
		return (
			<div className="flex flex-col gap-8">
				{pageHeader}
				<p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-xs">
					{configuredSkuCode ? (
						<>
							SKU <span className="font-mono">{configuredSkuCode}</span> was not
							found or has no price in the {marketCode} market.
						</>
					) : (
						<>
							No SKU with a price in the {marketCode} market. Add one, or set{" "}
							<span className="font-mono">CL_SKU_CODE</span> to pick it.
						</>
					)}
				</p>
			</div>
		);
	}
	const skuCode = sku.code;

	const shippingPreview = [
		ORDER_ADDRESS.line_1,
		ORDER_ADDRESS.city,
		ORDER_ADDRESS.country_code,
	].join(", ");

	return (
		<div className="flex flex-col gap-8">
			{pageHeader}

			<div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
				{sku.image_url ? (
					// biome-ignore lint/performance/noImgElement: this is a demo
					<img
						src={sku.image_url}
						alt={sku.name}
						className="h-64 w-full object-cover"
					/>
				) : (
					<div className="h-64 bg-gray-900" />
				)}

				<div className="p-6">
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">{sku.name ?? skuCode}</h2>
							<p className="mt-0.5 font-mono text-xs text-gray-400">
								{skuCode}
							</p>
							{price.formatted_amount && (
								<p className="mt-1 text-base font-semibold">
									{price.formatted_amount}
								</p>
							)}
						</div>
					</div>

					{sku.description && (
						<p className="mt-3 text-sm text-gray-600">{sku.description}</p>
					)}

					<div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
						<span className="h-2 w-2 rounded-full bg-green-500" />
						In stock
					</div>

					<div
						className={`mt-3 rounded-xl border px-3 py-2.5 text-xs transition-colors ${
							isCustomer
								? "border-green-200 bg-green-50 text-green-800"
								: "border-gray-100 text-gray-400"
						}`}
					>
						<div className="flex items-center justify-between gap-3">
							<div>
								{isCustomer ? (
									<p className="flex items-center gap-1.5 font-medium">
										<span className="h-2 w-2 rounded-full bg-green-500" />
										Logged in as customer
									</p>
								) : (
									<p>Guest session</p>
								)}
								<p className="mt-0.5">
									{isCustomer
										? (process.env.CL_CUSTOMER_EMAIL ?? CUSTOMER_EMAIL)
										: CUSTOMER_EMAIL}
								</p>
								<p className="mt-0.5">Shipping to: {shippingPreview}</p>
							</div>

							{isCustomer ? (
								<form action={logoutCustomer}>
									<button
										type="submit"
										className="cursor-pointer rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-100"
									>
										Logout
									</button>
								</form>
							) : (
								canLogin && (
									<form action={loginCustomer}>
										<button
											type="submit"
											className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
										>
											Login as customer
										</button>
									</form>
								)
							)}
						</div>
					</div>
				</div>

				<div className="border-t border-gray-100 p-6">
					<div className="flex flex-col gap-3">
						{stripeSetting ? (
							<ExpressCheckout
								accessToken={accessToken}
								skuCode={skuCode}
								stripeSettingId={stripeSetting.id}
								stripePublishableKey={stripeSetting.publicKey}
								subtotalCents={price.amount_cents}
								currencyCode={price.currency_code ?? "EUR"}
								isCustomer={isCustomer}
							/>
						) : (
							<p className="rounded-xl border border-gray-100 px-3 py-2.5 text-xs text-gray-400">
								Express payment unavailable —{" "}
								{hasIntegration
									? "no enabled Stripe payment setting in this market."
									: "integration application credentials are not set."}
							</p>
						)}

						<form action={createOrder.bind(null, skuCode)}>
							<OrderButton />
						</form>
					</div>
				</div>
			</div>

			{adyenSetting && APPLE_PAY_MERCHANT_ID && APPLE_PAY_MERCHANT_NAME && (
				<div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium text-gray-500">
							Adyen express (advanced flow — physical) — {skuCode}
							{price.formatted_amount ? ` · ${price.formatted_amount}` : ""}
						</p>
						<p className="text-[11px] text-gray-400">
							Advanced flow: no session/order until interaction, live shipping +
							tax recalculation in the sheet, final amount sent to /payments at
							authorization (via client_data + payment_authorization, polled
							until it settles). 3DS handled if Adyen requests it (rare for
							Apple Pay).
						</p>
						<AdyenExpressAdvanced
							accessToken={accessToken}
							skuCode={skuCode}
							adyenSettingId={adyenSetting.id}
							adyenClientKey={adyenSetting.publicKey}
							subtotalCents={price.amount_cents}
							currencyCode={price.currency_code ?? "USD"}
							countryCode={EXPRESS_COUNTRY_CODE}
							merchantName={APPLE_PAY_MERCHANT_NAME}
							merchantId={APPLE_PAY_MERCHANT_ID}
							isCustomer={isCustomer}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
