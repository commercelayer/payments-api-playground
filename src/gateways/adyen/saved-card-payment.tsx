"use client";

import type { PaymentSettingAdyen, PaymentWallet } from "@commercelayer/sdk";
import { useState } from "react";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";
import {
	type AdyenPendingAction,
	adyenAction,
	isAdyenAuthSuccess,
} from "./authorization";
import { AdyenWalletCvcStep } from "./saved-card-cvc-step";

/** The version of the Adyen /payments request CL builds for a stored card,
 * passed as the authorization's `_internal_version`. With a `payment_wallet`
 * attached, `WalletCvv` forces `shopperInteraction: Ecommerce`, merges the
 * shopper-entered `encryptedSecurityCode` into the stored-card `paymentMethod`,
 * and requests native 3DS
 * (`authenticationData.threeDSRequestData.nativeThreeDS: preferred`);
 * `recurringProcessingModel: CardOnFile` follows from the attached wallet, and
 * `shopperReference` is injected from `wallet.customer.shopper_reference`. */
const ADYEN_REUSE_INTERNAL_VERSION = "WalletCvv";

/** Adyen brand code for a stored card's CVC-only secured field, read from the
 * wallet's gateway payment_data (stored shape `brand`, event shape `paymentMethod`).
 * Normalizes the common mastercard alias to Adyen's "mc". */
function adyenWalletBrand(wallet: PaymentWallet): string {
	// biome-ignore lint/suspicious/noExplicitAny: gateway-specific payment_data
	const pd = (wallet.payment_data ?? {}) as Record<string, any>;
	const raw = String(pd.brand ?? pd.paymentMethod ?? "").toLowerCase();
	return raw === "mastercard" ? "mc" : raw;
}

/**
 * Pays with a card the customer stored with Adyen earlier.
 *
 * The merchant keeps Adyen's CVC-required policy for stored cards on, so a
 * stored-card /payments without a fresh CVC is refused (14_029). The shopper
 * first re-enters the CVC, then:
 *
 * 1. The payment_session is created with the `payment_wallet` relationship and
 *    only the encrypted CVC in `client_data.payment_method`. The stored token
 *    and every store/recurring field (storedPaymentMethodId, shopperReference,
 *    recurringProcessingModel, shopperInteraction) are added by CL.
 * 2. The authorization is created with CL's `WalletCvv` payload version, and
 *    polled until it settles.
 * 3. A 3-D Secure action, if Adyen asks for one, is handed back to the
 *    checkout through `onActionRequired`, which renders it.
 *
 * `shopperReference`, which Adyen requires for a stored-token charge, is
 * injected server-side from `wallet.customer.shopper_reference`: the client
 * never sends it.
 */
export function AdyenSavedCardPayment({
	client,
	orderId,
	wallet,
	setting,
	amountCents,
	currencyCode,
	authorizeGiftCards,
	onAuthorized,
	onActionRequired,
	onError,
	onCancel,
}: {
	client: PaymentClient;
	orderId: string;
	wallet: PaymentWallet;
	setting: PaymentSettingAdyen & { public_key?: string | null };
	amountCents: number;
	currencyCode: string;
	authorizeGiftCards: () => Promise<void>;
	onAuthorized: () => void;
	onActionRequired: (pending: AdyenPendingAction) => void;
	onError: (message: string) => void;
	onCancel: () => void;
}) {
	const [submitted, setSubmitted] = useState(false);
	const clientKey = setting.public_key;
	if (!clientKey || !wallet.payment_token) return null;

	async function pay(
		paymentMethod: Record<string, unknown>,
		browserInfo: unknown,
	) {
		if (!clientKey) return;
		setSubmitted(true);
		try {
			await authorizeGiftCards();
			const session = await client.payment_sessions.create({
				amount_cents: amountCents,
				client_data: {
					payment_method: paymentMethod,
					// CL reads snake_case client_data[:browser_info]; adyen-web emits
					// camelCase browserInfo. WalletCvv requires native 3DS → Adyen 15_002
					// ("browserInfo missing for device channel browser") without this.
					browser_info: browserInfo,
					return_url: window.location.href,
				},
				payment_setting: client.payment_settings.relationship(setting.id),
				order: client.orders.relationship(orderId),
				payment_wallet: client.payment_wallets.relationship(wallet.id),
			});

			const created = await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
				// Selects the WalletCvv `/payments` request. CL reads it from the
				// transaction it is building the request for, so it belongs here on the
				// authorization, not on the session.
				_internal_version: ADYEN_REUSE_INTERNAL_VERSION,
			});
			const auth = await pollAuthorization(client, created.id);

			const action = adyenAction(auth);
			if (action) {
				onActionRequired({ action, sessionId: session.id, clientKey });
				return;
			}
			if (auth.status === "requires_action") {
				throw new Error(
					"Adyen requires additional authentication but returned no action to render.",
				);
			}
			if (!isAdyenAuthSuccess(auth)) {
				const refusal = auth.response_data?.refusalReason;
				throw new Error(
					typeof refusal === "string" ? refusal : `Payment ${auth.status}.`,
				);
			}
			onAuthorized();
		} catch (e) {
			onError(e instanceof Error ? e.message : "Payment failed.");
		}
	}

	if (submitted) {
		return (
			<p className="px-6 py-5 text-sm text-gray-500">Processing payment…</p>
		);
	}

	return (
		<div className="px-6 py-5">
			<div className="mb-3 flex items-center justify-between">
				<p className="text-sm font-medium text-gray-700">
					Enter your card's security code
				</p>
				<button
					type="button"
					onClick={onCancel}
					className="cursor-pointer text-xs font-medium text-gray-400 transition hover:text-gray-600"
				>
					Cancel
				</button>
			</div>
			<AdyenWalletCvcStep
				orderId={orderId}
				storedPaymentMethodId={wallet.payment_token}
				brand={adyenWalletBrand(wallet)}
				clientKey={clientKey}
				amountCents={amountCents}
				currencyCode={currencyCode}
				onSubmit={pay}
				onError={onError}
			/>
		</div>
	);
}
