# Checkout.com: work in progress

The Checkout.com module works for one-off card payments but is not finished.
This file records where it stands, so the work can be picked up again.

## What works

Card payments through Flow (`@checkout.com/checkout-web-components`), from
the shopper's choice to a placed order, with and without a 3-D Secure
challenge, Amex included. A failed challenge leaves the payment open for
another card. `checkout-com-payment.tsx` describes the flow step by step, and
`tests/e2e/checkout-com-checkout.spec.ts` covers these cases.

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
- **Authorization:** Flow submits the payment itself. Once it is approved,
  its payment id (`pay_…`) goes into `client_data.payment_method` and the
  payment_authorization is created. CL reads that payment from Checkout.com
  instead of submitting a new one, and copies it, `3ds` block included, into
  the authorization's `response_data`. Flow's `handleSubmit` route (its
  `session_data` in `client_data`) is not the way: the authorization never
  settles.
- **3-D Secure:** Flow may run the challenge inside the page, and then calls
  `onPaymentCompleted` as for any other payment, or leave the page for it.
  Both have happened with the same test card. When it leaves, Checkout.com
  sends the shopper back to `success_url` or `failure_url` and appends
  `cko-payment-session-id`, `cko-session-id` and `cko-payment-id` to our own
  `checkout_com_return` parameter. On success the order page authorizes the
  session with the payment id from `cko-payment-id`. Either way it removes
  all four parameters from the URL.
- **Failed challenge:** so far it has always left the page, for `failure_url`. The order
  page shows the error, and Flow mounts again on the same session, where
  another card can pay. Checkout.com reports the declined payment to CL, which
  records it as a failed authorization on the session.

## What is missing

- **Successful return from a redirect:** authorizing with `cko-payment-id`
  has never run. The return to `success_url` itself worked on 2026-10-22, but
  since then Flow has kept successful challenges inside the page, so neither a
  manual test nor the e2e spec reaches it.
- **Stored cards and subscriptions:** not started. That means `vaulting: true`
  on the session, a branch in `handlePayWithWallet`, a badge in
  `saved-cards-section.tsx`, and the `payment_data` shape in `cardDisplay`.
  For now a Flow session reports `store_payment_details: disabled` even with
  `vaulting: true`, so no card gets stored.
- **Express payments:** Flow offers Apple Pay and Google Pay on this account,
  but only inside the checkout. Showing them on the product page is not
  started.
