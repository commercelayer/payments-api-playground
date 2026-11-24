"use client"

import type { PaymentSettingCheckoutCom } from "@commercelayer/sdk"
import { useState } from "react"
import type { GatewayPaymentProps } from "@/gateways/types"
import { errorMessage } from "@/lib/payments"
import { authorizeCheckoutComPayment } from "./authorization"
import { CheckoutComFlowStep } from "./flow-step"
import { checkoutComReturnUrls } from "./redirect-return"

/**
 * Card and wallet payment with Checkout.com Flow, from the shopper's choice to
 * an authorized payment_session.
 *
 * 1. Confirm creates the payment_session, with the `success_url` and
 *    `failure_url` Checkout.com requires in its `client_data`. CL creates a
 *    Checkout.com payment session and returns it in `response_data`.
 * 2. Flow mounts on that payment session, collects the payment details and
 *    submits the payment to Checkout.com itself, with its own pay button.
 * 3. Once Checkout.com approves it, its payment id goes into the session's
 *    `client_data.payment_method` and the CL payment_authorization is
 *    created. It submits nothing: CL reads that payment from Checkout.com and
 *    copies it into the authorization's `response_data`
 *    (`authorization.ts`). Flow may run a 3-D Secure challenge inside the
 *    page or leave it; when it leaves, the same happens on the order page
 *    the shopper comes back to (`redirect-return.ts`).
 *
 * Flow's `handleSubmit` route, its `session_data` token in `client_data`, is
 * not the way: the authorization never settles.
 *
 * To store the card, the session is created with `vaulting: true`. CL then
 * creates the Checkout.com payment session with card storage enabled, under
 * the customer's Checkout.com customer when there is one, and Flow asks no
 * consent of its own: it is asked here, as for Stripe. The approved payment
 * carries a reusable source, and the authorization links the payment_wallet
 * from it. A guest session never vaults, because a wallet needs a customer to
 * belong to.
 */
export function CheckoutComPayment({
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
  const [saveToWallet, setSaveToWallet] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [authorizeError, setAuthorizeError] = useState<string | null>(null)
  const { public_key: publicKey } = setting as PaymentSettingCheckoutCom

  async function handleConfirm() {
    if (amountCents == null) return
    setConfirming(true)
    setConfirmError(null)
    try {
      onSessionChange(
        await client.payment_sessions.create({
          amount_cents: amountCents,
          vaulting: !!customerId && (saveToWallet || mustSaveCard),
          client_data: checkoutComReturnUrls(orderId),
          payment_setting: client.payment_settings.relationship(setting.id),
          order: client.orders.relationship(orderId),
        }),
      )
    } catch (e) {
      setConfirmError(errorMessage(e, "Failed to confirm payment."))
    } finally {
      setConfirming(false)
    }
  }

  /** Called once Flow has submitted the payment and Checkout.com approved
   * it. */
  async function handleCompleted(paymentId: string) {
    if (!session) return
    setAuthorizeError(null)
    try {
      await authorizeCheckoutComPayment({
        client,
        session,
        paymentId,
        authorizeGiftCards,
      })
      onAuthorized()
    } catch (e) {
      setAuthorizeError(errorMessage(e, "Payment authorization failed."))
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
    )
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
  )
}
