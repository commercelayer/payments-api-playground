# Checkout.com: work in progress

The Checkout.com module is not finished and is not listed in the README yet.
This file records where it stands, so the work can be picked up again. Last
tested on 2026-10-08 against the stg1 environment.

## What works

Visa and Mastercard card payments work end to end through Flow
(`@checkout.com/checkout-web-components`): the session is created, Flow
collects the card and submits the payment, the CL payment_authorization
succeeds and the order is placed. `checkout-com-payment.tsx` describes the flow
step by step.

What we learned along the way:

- **Session create** needs `client_data: { success_url, failure_url }`, or
  Checkout.com refuses the session (`success_url_required`,
  `failure_url_required`). A sales channel token can send them.
  `response_data` is the Checkout.com payment session (`id`,
  `payment_session_secret`, `payment_session_token`), and Flow mounts on it as
  is.
- **Authorization:** Flow submits the payment itself. Only after
  `onPaymentCompleted` is the payment_authorization created. It sends nothing
  to Checkout.com (`request_data` stays empty); CL fills `response_data` with
  the Checkout.com payment a few seconds later.
- **Flow's `handleSubmit` does not work with CL.** Putting its `session_data`
  in `client_data` and creating the authorization leaves the authorization
  `pending` forever, without any call to Checkout.com.
- **Setting activation:** a newly created `payment_setting_checkout_coms` stays
  `pending`, with no `webhook_endpoint_id`, and is missing from the order's
  `available_payment_settings`. `_check`, `_enable` and re-sending the same
  `secret_key` change nothing. What activates it is a PATCH with
  `_provision_webhook: true`: it isn't in the SDK types, so it has to be sent
  as a raw request. CL then creates the webhook workflow on Checkout.com and
  the setting turns `active`.
- **`processing_channel_id_required`:** on a Checkout.com NAS account, every
  session was refused with this error until the account itself was
  configured. No CL attribute was involved.

## What is missing

### Blocked on the Commerce Layer API

1. **`public_key` is not returned.** Stripe, Braintree and Adyen expose their
   `public_key` on the setting in `order.available_payment_settings`, while
   `payment_setting_checkout_coms` doesn't. The module reads it from the
   setting like the other gateways and, without it, shows a notice instead of
   the Confirm button. As a result, Checkout.com can't be used from the
   playground until the API returns the key.
2. **3-D Secure never runs.** The payment session CL creates has no `3ds`
   field. Even Checkout.com's "challenge flow" test cards (e.g. Mastercard
   `5137210000000158`) are approved without a challenge, and the payment
   response has no `3ds` block. Without 3DS, SCA can't be met.
3. **Amex payments are refused.** CL sends the session `token`, a 36-character
   UUID, as the Checkout.com `reference`. For an Amex card Checkout.com
   refuses Flow's submit with 422 `merchant_reference_should_be_of_max_length_30`,
   which Flow shows only as "Network request failed". Visa and Mastercard
   accept the same reference.
4. **`_provision_webhook` is undocumented.** It is also missing from the SDK.
   Without it a new setting never becomes usable. It should either be
   documented or happen when the setting is created.
5. **The billing address line is malformed.** The session's `request_data`
   sends `address_line1` as `"John Doe 123 Main St,"`, with the name in front
   and a trailing comma.

### Playground work left

- **3-D Secure return:** `redirect-return.ts` (the `checkout_com_return` query
  parameter on `success_url` / `failure_url`) is written and wired into
  `payment-section.tsx`, but it has never run, since no payment has gone
  through 3DS yet (point 2). Once it can, check which query parameters
  Checkout.com appends to the return URL, and remove them together with ours.
- **Stored cards and subscriptions:** not started. That means `vaulting: true`
  on the session, a branch in `handlePayWithWallet`, a badge in
  `saved-cards-section.tsx`, and the `payment_data` shape in `cardDisplay`.
  The test account's Flow session currently reports
  `store_payment_details: disabled`.
- **Express payments:** Flow offers Apple Pay and Google Pay on this account,
  but only inside the checkout. Showing them on the product page needs the
  public key before any session exists (point 1).
- **README:** add Checkout.com to the gateway list, the "Reading the code"
  table and the organization setup, including the `_provision_webhook` step
  and the processing channel.
- **E2E spec:** card entry happens inside Flow's cross-origin iframes. The
  Chrome extension can't type there, so a Playwright spec has to drive the
  frames directly, as the Adyen specs do.
