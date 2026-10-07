# End-to-end tests

Playwright tests that drive the real checkout UI against the Commerce Layer
sandbox org configured in `.env.local`. They validate the new payments API flows
end to end (order created → payment session → authorization → order placed).

## Prerequisites

- **This project uses [pnpm](https://pnpm.io/).** Use `pnpm install` / `pnpm add`.
  `npm install` fails here with `Cannot read properties of null (reading 'matches')`
- A configured `.env.local` (the tests reuse it via `next dev`).
- One-time browser install: `pnpm exec playwright install chromium`.

## Running

```bash
pnpm test:e2e                  # all specs
pnpm test:e2e payment-methods  # a single spec by name
pnpm test:e2e --ui             # interactive UI mode
```

`playwright.config.ts` boots `pnpm dev` as the web server (so Next loads
`.env.local` itself), runs single-worker Chromium, and traces on first retry.

Orders can't be deleted in Commerce Layer and this points at a **test org**, so
seeded test orders simply accumulate — there is no teardown.

## Layout & the reusable entry point

```
tests/e2e/
  checkout-page.ts            # CheckoutPage Page Object (the reusable setup)
  fixtures.ts                 # `checkout` fixture → page ready for payment selection
  payment-methods.spec.ts     # the available payment methods render
  stripe-checkout.spec.ts     # full Stripe payment → order placed
  gift-card-plus-stripe.spec.ts  # apply a gift card, pay the remaining with Stripe
  gift-cards-plus-stripe-plus-adyen.spec.ts  # 2 gift cards + partial Stripe + Adyen for the rest
  adyen-checkout.spec.ts      # full Adyen payment → order placed
  adyen-advanced-checkout.spec.ts  # Adyen advanced-flow card, then paying again with the saved card
  adyen-paypal.spec.ts        # PayPal popup through the Adyen Drop-in (needs E2E_PAYPAL_*)
  braintree-checkout.spec.ts  # Braintree Hosted Fields (3DS challenge, frictionless, decline + retry) and Drop-in
```

Gift cards are created via the debug "Gift Cards" panel on the order page
(`CheckoutPage.createGiftCard`) and applied through the checkout's gift-card
input (`applyGiftCard`). They're created in the **market currency** — a gift card
must match the order currency to apply, so on the USD sandbox a "10 euro" card is
created as $10.

- `CheckoutPage.create()` places a fresh order from the store home ("Checkout"
  button) and lands on `/orders/[id]` ready for payment selection.
- The `checkout` fixture runs `create()` and hands each test a ready-to-pay
  checkout.

## Adding a scenario

Gift cards, multiple/partial payments, Adyen, save-to-wallet, etc.:

1. Add a new `*.spec.ts` that imports `{ test, expect }` from `./fixtures` and
   destructures `{ checkout }` — it starts already on the checkout page.
2. Add new actions/locators to `CheckoutPage` rather than inlining selectors in
   the spec, so they're reused across scenarios.

```ts
import { expect, test } from "./fixtures";

test("...", async ({ checkout }) => {
  await checkout.selectMethod("payment_setting_manuals");
  // ...
});
```

## Stripe Elements selectors (gotcha)

The Stripe `PaymentElement` card inputs are **not** reachable via
`getByRole`/aria-label. For the current Stripe.js version they live in the iframe
whose `src` contains `elements-inner-accessory-target`, as plain inputs with
`name="number"` / `name="expiry"` / `name="cvc"` (no aria-labels). The other
`title="Secure payment input frame"` iframe (`elements-inner-easel`) is Stripe's
dev-tools overlay, not the inputs — matching by that title hits two frames and
trips Playwright strict mode.

These selectors are pinned in `checkout-page.ts` (`stripeCardFrame()` /
`fillStripeTestCard()`). If Stripe restructures its iframes and the card-number
field stops being found, re-dump the live frame tree with a throwaway spec that
iterates `page.frames()` and logs each frame's `input` attributes, then re-pin.

**Type the card digits, don't `fill()` them.** `fill()` sets the value without
firing all of Stripe's input handlers, so the field can still read as
"incomplete" when Authorize triggers `confirmPayment` — an intermittent failure.
`fillStripeTestCard()` uses `pressSequentially` and then asserts the number stuck
before proceeding.

Test card `4242 4242 4242 4242`, any future expiry, any CVC. Placement completes
without extra webhook setup — the sandbox's Stripe webhook is already configured.

## Adyen Drop-in (gotcha)

The Adyen Drop-in auto-selects the "Cards" method and renders the card number /
expiry / security code as three encrypted iframes, each inside a
`.adyen-checkout__field--{cardNumber,expiryDate,securityCode}` container with
inputs labelled "Card number" / "Expiry date" / "Security code". There's no
Authorize button — the Drop-in's own **Pay** button drives authorization via its
`onPaymentCompleted` callback. Same rule as Stripe: **type, don't `fill()`**.
Pinned in `checkout-page.ts` (`adyenField()` / `fillAdyenTestCard()` /
`submitAdyen()`).

Test card `4988 4388 4388 4305`, exp `03/30`, CVC `737` (authorizes without a 3DS
challenge in this sandbox).

## Braintree Hosted Fields and Drop-in (gotcha)

Both widgets mount each card field in its own `iframe[name="braintree-hosted-field-{cardholderName,number,expirationDate,cvv}"]`.
Each frame also carries hidden autofill inputs, so the visible one is selected by
`input[data-braintree-name="<field>"]`. A complete field gets
`braintree-hosted-fields-valid` on its container, and `fillBraintreeField()` waits
for that and retypes otherwise, as for Adyen. The Drop-in shows CVV only when the
merchant account's rules require it, so the helper fills CVV only when present.

The 3-D Secure challenge is Cardinal's modal iframe `#Cardinal-CCA-IFrame`. The
sandbox prints the code (`1234`) on the page: placeholder "Enter Code Here",
button **SUBMIT** (`completeBraintreeChallenge()`).

Test cards (any future expiry, CVV `123`):

| Card | Outcome |
|---|---|
| `4005 5192 0000 0004` | 3DS challenge, then authorized |
| `4000 0000 0000 1091` | 3DS challenge, then authorized (used by the Drop-in test) |
| `4000 0000 0000 1000` | frictionless 3DS, authorized |

A **decline** is driven by the amount, not the card: a total between 2000.00 and
2999.99 comes back `PROCESSOR_DECLINED`. `raiseTotalTo()` gets the order there
by setting the line item quantity through the integration API.

Braintree's **duplicate check** rejects the same card for the same amount within
a short window (`GATEWAY_REJECTED`, which the checkout shows as a decline). Every
fixture order has the same total, so two tests in one run must not share a card.
Re-running the spec straight away can trip it as well.
