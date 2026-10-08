"use client";

import type { PaymentSettingAdyen } from "@commercelayer/sdk";
import { useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage } from "@/lib/payments";
import { AdyenAdvancedCardStep } from "./advanced-card-step";
import { AdyenDropinStep } from "./dropin-step";

/**
 * Card payment with Adyen, from the shopper's choice to an authorized
 * payment_session. Two integrations, picked with a demo toggle before Confirm:
 *
 * **Drop-in (Adyen sessions flow)**, the default:
 * 1. Confirm creates the payment_session. CL opens an Adyen session and returns
 *    its `id` and `sessionData` in the session's `response_data`.
 * 2. The Drop-in mounts on that Adyen session and runs the whole payment with
 *    Adyen, 3-D Secure included. A redirecting method leaves the page here and
 *    resumes in `redirect-return.ts`.
 * 3. Once the Drop-in reports success, the CL payment_authorization is
 *    created.
 *
 * **Card Component (advanced flow)**: no session at Confirm. The card form
 * mounts on the amount alone, and the session, the authorization and the
 * payment_wallet are all created server-side when the card is submitted
 * (`advanced-card-step.tsx`, `actions.ts`).
 *
 * Storing the card: the Drop-in session is created with `vaulting: true` for
 * every logged-in shopper. CL then sends `storePaymentMethodMode:
 * askForConsent`, which makes the Drop-in render its own "save for next time"
 * checkbox, together with shopperReference and recurringProcessingModel. The
 * wallet arrives from Adyen's RECURRING_CONTRACT webhook, nothing is written
 * client-side. Storing can't be made mandatory on the Drop-in, since CL always
 * asks for consent; the advanced-flow card can enforce it on a recurring order.
 */
export function AdyenPayment({
	client,
	orderId,
	setting,
	amountCents,
	currencyCode,
	customerId,
	mustSaveCard,
	session,
	onSessionChange,
	onFormOpenChange,
	authorizeGiftCards,
	onAuthorized,
	onCancel,
}: GatewayPaymentProps) {
	// public_key is not in the read-type but is stored on the resource
	const clientKey =
		(setting as PaymentSettingAdyen & { public_key?: string | null })
			.public_key ?? null;
	const [useAdvancedCard, setUseAdvancedCard] = useState(false);
	// Set when the advanced-flow card is mounted, to the amount it was built for.
	const [advancedAmountCents, setAdvancedAmountCents] = useState<number | null>(
		null,
	);
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [authorizing, setAuthorizing] = useState(false);
	const [authorizeError, setAuthorizeError] = useState<string | null>(null);

	async function handleConfirm() {
		if (amountCents == null) return;
		if (useAdvancedCard) {
			setAdvancedAmountCents(amountCents);
			onFormOpenChange?.(true);
			return;
		}
		setConfirming(true);
		setConfirmError(null);
		try {
			const created = await client.payment_sessions.create({
				amount_cents: amountCents,
				// A wallet needs a customer to belong to, so a guest never vaults.
				vaulting: !!customerId,
				// Where Adyen sends the shopper back after a redirect: this page.
				client_data: { return_url: window.location.href },
				payment_setting: client.payment_settings.relationship(setting.id),
				order: client.orders.relationship(orderId),
			});
			onSessionChange(created);
		} catch (e) {
			setConfirmError(errorMessage(e, "Failed to confirm payment."));
		} finally {
			setConfirming(false);
		}
	}

	/** The Drop-in reported an accepting result code (Authorised / Pending /
	 * Received). If the shopper ticked its "save card" checkbox, CL creates the
	 * payment_wallet from Adyen's webhook — nothing to do here. */
	async function handleDropinAuthorized() {
		if (!session) return;
		setAuthorizing(true);
		setAuthorizeError(null);
		try {
			await authorizeGiftCards();
			await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
			});
			onAuthorized();
		} catch (e) {
			setAuthorizeError(errorMessage(e, "Payment authorization failed."));
		} finally {
			setAuthorizing(false);
		}
	}

	/** The advanced-flow card got its session authorized server-side. Gift cards
	 * are authorized only now: the card's authorization happens inside the
	 * server action, so this is the first point where Adyen has accepted it. */
	async function handleAdvancedAuthorized() {
		try {
			await authorizeGiftCards();
		} catch {
			/* best-effort; placement will surface any real problem */
		}
		onFormOpenChange?.(false);
		onAuthorized();
	}

	function cancelAdvanced() {
		onFormOpenChange?.(false);
		onCancel();
	}

	if (advancedAmountCents != null && clientKey) {
		return (
			<div className="mt-3 flex flex-col gap-3">
				<AdyenAdvancedCardStep
					orderId={orderId}
					settingId={setting.id}
					clientKey={clientKey}
					amountCents={advancedAmountCents}
					currencyCode={currencyCode}
					customerId={customerId}
					mustSaveCard={mustSaveCard}
					onAuthorized={handleAdvancedAuthorized}
					onError={setAuthorizeError}
				/>
				{authorizeError && (
					<p className="text-xs text-red-500">{authorizeError}</p>
				)}
				<button
					type="button"
					onClick={cancelAdvanced}
					className="cursor-pointer self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400"
				>
					Cancel
				</button>
			</div>
		);
	}

	if (session) {
		return (
			<div className="mt-3">
				<AdyenDropinStep
					pendingSession={session}
					clientKey={clientKey}
					authorizing={authorizing}
					authorizeError={authorizeError}
					onAuthorized={handleDropinAuthorized}
					onError={setAuthorizeError}
					onReset={onCancel}
				/>
			</div>
		);
	}

	return (
		<div className="mt-2 flex flex-col gap-2">
			<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
				<input
					type="checkbox"
					checked={useAdvancedCard}
					onChange={(e) => setUseAdvancedCard(e.target.checked)}
					className="accent-gray-900"
				/>
				Advanced flow (Card Component) — instead of the Drop-in
			</label>
			<button
				type="button"
				onClick={handleConfirm}
				disabled={amountCents == null || confirming}
				className="cursor-pointer self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{confirming ? "Confirming…" : "Confirm"}
			</button>
			{confirmError && <p className="text-xs text-red-500">{confirmError}</p>}
		</div>
	);
}
