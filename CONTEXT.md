# @commercelayer/payments-api-playground

A Next.js playground for Commerce Layer's **new payments API**
(`payment_settings` + `payment_sessions`), which replaces the deprecated
`payment_gateways` + `payment_methods` model. The SDK (`@commercelayer/sdk` v8),
generated from the API schema, is the source of truth.

## Language

**Payment Setting**:
A configured payment gateway (Stripe, Adyen, Manual, Gift Card, …) at the organization/market
level. The new replacement for a *payment gateway* + *payment method* pair. Modelled per-provider
(`payment_setting_stripes`, `payment_setting_adyens`, …).
_Avoid_: payment gateway, payment method.

**Payment Session**:
One intended payment against an order, for an `amount_cents`, through a payment setting. Replaces
the old per-gateway payment-source resources (`stripe_payments`, `adyen_payments`, …). Its lifecycle
is Payment Session → Payment Authorization → Payment Capture (→ Payment Refund). An order can carry
several sessions (split payment).
_Avoid_: payment source, charge, payment intent.

**Express Payment**:
Buying directly from the product page via a wallet button (Apple Pay / Google Pay), without visiting
the checkout page. Contrast with the full checkout on `/orders/[id]`.
_Avoid_: quick checkout, one-click, instant checkout.

**Redacted Address**:
The partial shipping address (country, state, city, postal code) a wallet exposes while its payment
sheet is open, before the buyer authorizes. Sufficient to compute shipping and tax; the street line,
name, and email are withheld until authorization.
_Avoid_: partial address, anonymous address.

**Payment Wallet**:
A customer's saved card stored for reuse, modelled as the new-API `payment_wallets` resource
(gateway-agnostic; belongs to a `customer` + a `payment_setting`). Holds the gateway tokens
(`customer_token` = shopper reference, `payment_token` = stored method id) plus display data
(`payment_data`: brand/last4/exp). A `payment_session` can reference the `payment_wallet` it reused.
_Not to be confused with_ the device **wallet** (Apple Pay / Google Pay) button in *Express Payment* —
that is a one-time device token, not a stored card.
_Avoid_: customer payment source (old-API name), stored card as a bare gateway token.

**Order Subscription**:
A recurring purchase agreement for a customer, modelled as `order_subscriptions`. It carries a
`frequency` and a lifecycle (`draft → pending → inactive → active → running → cancelled`), and on each
run generates a new order from a *Source Order*. Charges its bound *Payment Wallet* + *Payment Setting*
as a *Merchant-Initiated Payment*.
_Avoid_: recurring order, standing order, plan.

**Subscription Model**:
Market-level configuration declaring which `frequencies` are available (and `auto_activate`).
Associated to a *Market*, not set per-subscription. An *Order Subscription* whose frequency matches a
model on its market becomes **automatic** (recurring charges fire); without a matching model it is a
**manual** subscription that never self-charges.
_Avoid_: plan, tier, billing scheme.

**Source Order** / **Target Order**:
The *Source Order* is the placed order that seeds an *Order Subscription* (the checkout the customer
actually completed). A *Target Order* is a fresh order copied from the source on each subscription run.
With `activate_by_source_order`, the source order counts as run #1, so the first *Target Order* is
run #2.
_Avoid_: parent/child order, original order, renewal order.

**Merchant-Initiated Payment** (a.k.a. stored-credential charge, Adyen `ContAuth`):
A charge Commerce Layer initiates against a customer's saved *Payment Wallet* with **no shopper
present**, on the subscription's schedule. Contrast with the shopper-present checkout charge, where the
customer authorizes in real time (Adyen `Ecommerce`).
_Avoid_: recurring charge (ambiguous), auto-payment, background charge.

**Recalculation** (a.k.a. quote):
Commerce Layer recomputing an order's shipments, `available_shipping_methods`, taxes, promotions, and
totals after its shipping address or shipping method changes. The mechanism that resolves the
express-payment circular dependency (a wallet total needs shipping + tax, which need an address the
wallet only reveals once open).
_Avoid_: repricing, tax quote.

## Example dialogue

> **Dev:** For express pay, when do we create the payment session?
> **Domain expert:** Not until the buyer authorizes. During the sheet you only have a *redacted
> address* — enough to drive a *recalculation* and show a total, but the *payment session* is created
> at confirm, once the amount is final, against the chosen *payment setting*.
> **Dev:** And the gateway resource per provider?
> **Domain expert:** That's the *payment setting* — `payment_setting_stripes` here. Its `public_key`
> is what the browser needs. The old *payment gateway* / *payment method* pair is gone.
