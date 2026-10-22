"use client";

import type { PaymentSettingCheckoutCom } from "@commercelayer/sdk";
import { useState } from "react";
import type { GatewayPaymentProps } from "@/gateways/types";
import { errorMessage, pollAuthorization } from "@/lib/payments";
import { CheckoutComFlowStep } from "./flow-step";

/**
 * Card and wallet payment with Checkout.com Flow, from the shopper's choice to
 * an authorized payment_session.
 *
 * 1. Confirm creates the payment_session, with the `success_url` and
 *    `failure_url` Checkout.com requires in its `client_data`. CL creates a
 *    Checkout.com payment session and returns it in `response_data`.
 * 2. Flow mounts on that payment session, collects the payment details and
 *    submits the payment to Checkout.com itself, with its own pay button.
 * 3. Once Checkout.com approves it, the CL payment_authorization is created.
 *    It sends nothing to Checkout.com: CL picks up the payment Flow made for
 *    this session and copies it into the authorization's `response_data`.
 *    That happens asynchronously, so the authorization is polled until it
 *    settles.
 *
 * Flow's `handleSubmit` route, its `session_data` token in `client_data`, is
 * not the way: the authorization never settles.
 */
export function CheckoutComPayment({
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
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [authorizeError, setAuthorizeError] = useState<string | null>(null);
	const { public_key: publicKey } = setting as PaymentSettingCheckoutCom;

	function returnUrls() {
		const orderUrl = `${window.location.origin}/orders/${orderId}`;
		return {
			success_url: `${orderUrl}?checkout_com_return=success`,
			failure_url: `${orderUrl}?checkout_com_return=failure`,
		};
	}

	async function handleConfirm() {
		if (amountCents == null) return;
		setConfirming(true);
		setConfirmError(null);
		try {
			onSessionChange(
				await client.payment_sessions.create({
					amount_cents: amountCents,
					client_data: returnUrls(),
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

	/** Called once Flow has submitted the payment and Checkout.com approved
	 * it. */
	async function handleCompleted() {
		if (!session) return;
		setAuthorizeError(null);
		try {
			await authorizeGiftCards();
			const created = await client.payment_authorizations.create({
				payment_session: client.payment_sessions.relationship(session.id),
			});
			const auth = await pollAuthorization(client, created.id);
			if (auth.status !== "succeeded") {
				throw new Error(
					`The payment was not authorized (authorization ${auth.status}).`,
				);
			}
			onAuthorized();
		} catch (e) {
			setAuthorizeError(errorMessage(e, "Payment authorization failed."));
		}
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

	return (
		<div className="mt-3">
			<CheckoutComFlowStep
				pendingSession={session}
				publicKey={publicKey}
				authorizeError={authorizeError}
				onCompleted={handleCompleted}
				onError={setAuthorizeError}
				onReset={onCancel}
			/>
		</div>
	);
}
