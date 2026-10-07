"use client";

import type { PaymentSettingStripe } from "@commercelayer/sdk";
import { useRef, useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage } from "@/lib/payments";
import {
	type StripeFormHandle,
	StripePaymentForm,
} from "./stripe-elements-form";

/**
 * Card payment with Stripe, from the shopper's choice to an authorized
 * payment_session.
 *
 * 1. Confirm creates the payment_session. CL creates the Stripe PaymentIntent
 *    and returns its `client_secret` in the session's `response_data`.
 * 2. Stripe Elements mounts on that `client_secret` and collects the card.
 * 3. Authorize runs Stripe's `confirmPayment`, which handles 3-D Secure inline.
 *    A redirect-based method (Amazon Pay) leaves the page here instead and
 *    resumes in `resumeStripeRedirect`.
 * 4. The CL payment_authorization is created: CL reads the confirmed
 *    PaymentIntent and records the authorization.
 *
 * To store the card, the session is created with `vaulting: true`. CL then
 * sends `setup_future_usage: off_session` on the PaymentIntent, attaches a
 * Stripe customer, and links the payment_wallet itself when the authorization
 * reads the charge. Nothing is written client-side. CL never turns vaulting on
 * by itself, not even on a recurring order, because storing a card takes the
 * shopper's consent, which only the storefront collects. A wallet needs a
 * customer to belong to, so a guest session never vaults.
 */
export function StripePayment({
	client,
	orderId,
	setting,
	amountCents,
	customerId,
	mustSaveCard,
	session,
	onSessionChange,
	authorizeGiftCards,
	onAuthorized,
	onCancel,
}: GatewayPaymentProps) {
	const publicKey = (setting as PaymentSettingStripe).public_key ?? null;
	const [saveToWallet, setSaveToWallet] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [authorizing, setAuthorizing] = useState(false);
	const [authorizeError, setAuthorizeError] = useState<string | null>(null);
	const formRef = useRef<StripeFormHandle | null>(null);

	async function handleConfirm() {
		if (amountCents == null) return;
		setConfirming(true);
		setConfirmError(null);
		try {
			const created = await client.payment_sessions.create({
				amount_cents: amountCents,
				vaulting: !!customerId && (saveToWallet || mustSaveCard),
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

	async function handleAuthorize() {
		if (!session) return;
		setAuthorizing(true);
		setAuthorizeError(null);
		try {
			await formRef.current?.triggerConfirm();
			await authorizeGiftCards();
			// On a vaulting session this authorization is also what saves the card:
			// CL reads the confirmed PaymentIntent and links the payment_wallet
			// from its payment_method and customer.
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

	if (!session) {
		return (
			<div className="mt-2 flex flex-col gap-2">
				{customerId &&
					(mustSaveCard ? (
						<p className="text-xs text-gray-500">
							This card will be saved — the subscription needs it to charge the
							orders after this one.
						</p>
					) : (
						<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
							<input
								type="checkbox"
								checked={saveToWallet}
								onChange={(e) => setSaveToWallet(e.target.checked)}
								disabled={confirming}
								className="accent-gray-900"
							/>
							Save card for future use
						</label>
					))}
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

	const clientSecret =
		typeof session.response_data?.client_secret === "string"
			? session.response_data.client_secret
			: null;
	const canAuthorize = !authorizing && !!clientSecret && !!publicKey;

	return (
		<div className="mt-3 flex flex-col gap-3">
			{clientSecret && publicKey && (
				<StripePaymentForm
					ref={formRef}
					clientSecret={clientSecret}
					publishableKey={publicKey}
				/>
			)}
			{authorizeError && (
				<p className="text-xs text-red-500">{authorizeError}</p>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleAuthorize}
					disabled={!canAuthorize}
					className="cursor-pointer rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{authorizing ? "Authorizing…" : "Authorize"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={authorizing}
					className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
