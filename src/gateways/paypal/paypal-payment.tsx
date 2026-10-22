"use client";

import type { PaymentSettingPaypal } from "@commercelayer/sdk";
import { useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage, pollAuthorization } from "@/lib/payments";
import { PayPalButtonStep } from "./paypal-button-step";

/**
 * PayPal checkout through a PayPal payment setting, from the shopper's choice
 * to an authorized payment_session.
 *
 * 1. Confirm creates the payment_session. CL creates a PayPal order for it
 *    (Orders v2 API) and keeps the PayPal order id as the session's `token`.
 * 2. PayPal's button (JS SDK v6) opens PayPal's window on that order. The
 *    shopper logs in and approves there. Nothing is written back to the
 *    session: PayPal records the approval on its own order.
 * 3. The CL payment_authorization is created. CL authorizes the approved
 *    PayPal order (or captures it, when the setting has auto capture on). It
 *    is polled until it settles.
 *
 * One-off orders only: storing the PayPal account for later is not offered
 * yet.
 */
export function PayPalPayment({
	client,
	orderId,
	setting,
	amountCents,
	session,
	onSessionChange,
	authorizeGiftCards,
	onAuthorized,
	onCancel,
}: GatewayPaymentProps) {
	// The client id PayPal's JS SDK loads with. It is public, so the setting
	// returns it, but the SDK's type doesn't declare it yet.
	const clientId =
		(setting as PaymentSettingPaypal & { client_id?: string | null })
			.client_id ?? null;
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [authorizing, setAuthorizing] = useState(false);
	const [authorizeError, setAuthorizeError] = useState<string | null>(null);

	async function handleConfirm() {
		if (amountCents == null) return;
		setConfirming(true);
		setConfirmError(null);
		try {
			onSessionChange(
				await client.payment_sessions.create({
					amount_cents: amountCents,
					payment_setting: client.payment_settings.relationship(setting.id),
					order: client.orders.relationship(orderId),
				}),
			);
		} catch (e) {
			setConfirmError(errorMessage(e, "Failed to confirm payment."));
		} finally {
			setConfirming(false);
		}
	}

	/**
	 * Called once the shopper has approved in PayPal's window. An approved
	 * PayPal order can be authorized only once, so after a decline the shopper
	 * cancels and confirms again, which creates a new session and a new PayPal
	 * order.
	 */
	async function handleApprove() {
		if (!session) return;
		setAuthorizing(true);
		setAuthorizeError(null);
		try {
			await authorizeGiftCards();
			const created = await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
			});
			const auth = await pollAuthorization(client, created.id);
			if (auth.status === "pending") {
				throw new Error(
					"The payment could not be confirmed. Please try again in a moment.",
				);
			}
			if (auth.status !== "succeeded") {
				throw new Error("PayPal declined the payment.");
			}
			onAuthorized();
		} catch (e) {
			setAuthorizeError(errorMessage(e, "Payment authorization failed."));
		} finally {
			setAuthorizing(false);
		}
	}

	if (!clientId) {
		return (
			<p className="mt-2 text-xs text-red-500">
				This payment setting has no PayPal client id.
			</p>
		);
	}

	if (!session) {
		return (
			<div className="mt-2 flex flex-col gap-2">
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

	if (!session.token) {
		return (
			<p className="mt-2 text-xs text-red-500">
				PayPal did not return an order for this session.
			</p>
		);
	}

	return (
		<div className="mt-3">
			<PayPalButtonStep
				clientId={clientId}
				paypalOrderId={session.token}
				authorizing={authorizing}
				authorizeError={authorizeError}
				onApprove={handleApprove}
				onError={setAuthorizeError}
				onReset={onCancel}
			/>
		</div>
	);
}
