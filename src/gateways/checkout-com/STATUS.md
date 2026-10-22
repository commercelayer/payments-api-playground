# Checkout.com: work in progress

The Checkout.com module works for one-off card payments but is not finished,
and it is not listed in the README yet. This file records where it stands, so
the work can be picked up again.

## What works

Card payments through Flow (`@checkout.com/checkout-web-components`), from
the shopper's choice to a placed order, with and without a 3-D Secure
challenge, Amex included. `checkout-com-payment.tsx` describes the flow step
by step.

Notes for whoever picks this up:

- **Setting setup:** create the `payment_setting_checkout_coms` with the
  account's secret and public keys, then call
  `payment_setting_checkout_coms._provision_webhook(id)` on it. That creates
  the webhook workflow on Checkout.com, and the setting turns `active`.
- **Processing channel:** on a Checkout.com NAS account, sessions are refused
  with `processing_channel_id_required` until the account has a default
  processing channel configured.
- **Session create** needs `client_data: { success_url, failure_url }`, or
  Checkout.com refuses the session (`success_url_required`,
  `failure_url_required`). A sales channel token can send them.
  `response_data` is the Checkout.com payment session (`id`,
  `payment_session_secret`, `payment_session_token`), and Flow mounts on it as
  is, with the setting's `public_key`.
- **Authorization:** Flow submits the payment itself. Only once it is
  approved is the payment_authorization created. It sends nothing to
  Checkout.com: CL fills its `response_data` with the Checkout.com payment,
  `3ds` block included, within a couple of seconds. Flow's `handleSubmit`
  route (its `session_data` in `client_data`) is not the way: the
  authorization never settles.
- **3-D Secure return:** after a challenge Flow doesn't call
  `onPaymentCompleted`. Checkout.com sends the shopper back to `success_url`
  and appends `cko-payment-session-id`, `cko-session-id` and `cko-payment-id`
  to our own `checkout_com_return` parameter. The order page then creates the
  authorization and removes all four parameters from the URL.

## What is missing

- **Failure return:** the `failure_url` path (a declined or abandoned
  challenge) has never run.
- **Stored cards and subscriptions:** not started. That means `vaulting: true`
  on the session, a branch in `handlePayWithWallet`, a badge in
  `saved-cards-section.tsx`, and the `payment_data` shape in `cardDisplay`.
  The test account's Flow session reports `store_payment_details: disabled`,
  so the Checkout.com account needs that enabled first.
- **Express payments:** Flow offers Apple Pay and Google Pay on this account,
  but only inside the checkout. Showing them on the product page is not
  started.
- **README:** add Checkout.com to the gateway list, the "Reading the code"
  table and the organization setup (keys, `_provision_webhook`, processing
  channel).
- **E2E spec:** card entry happens inside Flow's cross-origin iframes, so a
  Playwright spec has to drive the frames directly, as the Adyen specs do.
  Until it exists, a person has to enter the card by hand.
