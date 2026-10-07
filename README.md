# Payments API Playground

`@commercelayer/payments-api-playground` is a Next.js app for trying
[Commerce Layer](https://commercelayer.io)'s new payments API against your own
organization: payment settings, payment sessions, authorizations, captures,
gift cards, stored cards and subscriptions, across several gateways. For the
ideas behind the API, read
[Introducing our new Payments API](https://commercelayer.io/blog/payment-api-redesigned).

It is also meant to be read. Each gateway's integration lives in its own
folder, so you (or an AI agent) can follow one gateway from the shopper's
choice to an authorized payment session and use it as a starting point for
your own integration.

> [!WARNING]
> This is a development tool. Run it locally, or on a private deploy, against a
> **test organization with sandbox gateway accounts**. Don't deploy it
> publicly: several server-side paths act with your integration application's
> credentials on behalf of whoever opens the page (see
> [Why not a public deploy](#why-not-a-public-deploy)).

## What you can try

- **Checkout with several gateways:** Stripe (Payment Element), Adyen (Drop-in,
  or the Card Component in the advanced flow), Braintree (Hosted Fields or
  Drop-in), Mollie as an external payment setting, and manual payments (wire
  transfer).
- **Split payments:** pay part of the order with one method and the rest with
  another. Each authorized payment session lowers the balance, and the order is
  placed when nothing is left to pay.
- **Gift cards:** apply one or more before choosing a method.
- **Stored cards:** a logged-in customer can save a card while paying (Stripe,
  Adyen) and pay with it on the next order.
- **Subscriptions:** pick a frequency on the order, pay with a card that gets
  stored, and manage the subscription Commerce Layer creates.
- **Redirects and 3-D Secure:** Amazon Pay through Stripe, Klarna through
  Adyen, Mollie's hosted checkout, and 3-D Secure challenges.
- **Express payments** on the product page: Apple Pay / Google Pay through
  Stripe, and Apple Pay through Adyen's advanced flow.

## Reading the code

| Where | What |
|---|---|
| `src/gateways/stripe/` | Stripe card payment, the Amazon Pay redirect return, stored-card reuse, express checkout |
| `src/gateways/adyen/` | Adyen Drop-in and advanced-flow card, stored cards with CVC, 3-D Secure, redirect returns, express checkout |
| `src/gateways/braintree/` | Braintree Hosted Fields and Drop-in, with 3-D Secure in the browser |
| `src/gateways/mollie/` | Mollie through an external payment setting, including the server routes Commerce Layer calls (`server/`) |
| `src/gateways/manual/` | Manual payment: session and authorization in one step |
| `src/gateways/types.ts` | The contract between the checkout and a gateway module |
| `src/components/payment-section.tsx` | What every gateway shares: gift cards, the balance, stored cards, redirect returns, placing the order |
| `CONTEXT.md` | The domain vocabulary (payment setting, payment session, payment wallet, …) |

Each gateway's main file opens with a comment that walks through its flow step
by step.

## Requirements

- Node.js 20.9 or later
- [pnpm](https://pnpm.io/)
- A Commerce Layer organization, ideally a test one, with sandbox accounts on
  the gateways you want to try

## Set up your organization

The playground sells a single SKU on a single market. The organization needs:

- **A market** with a price list and stock for at least one SKU, and shipping
  methods that cover the country the orders ship to (`CL_ADDRESS_COUNTRY_CODE`).
- **A sales channel application.** Its client ID is the only credential the
  storefront uses.
- **An integration application** (optional, see below). It backs the express
  buttons, Adyen's advanced flow and the debug panels.
- **The payment settings you want to try**, enabled and listed on the market:
  `payment_setting_stripes`, `payment_setting_adyens`,
  `payment_setting_braintrees`, `payment_setting_externals` (Mollie),
  `payment_setting_manuals`, and `payment_setting_gift_cards` for gift cards.
  Card gateways need their sandbox credentials and their public key. Adyen's
  client key must allow the origin you run the app on, for example
  `http://localhost:3000`.
- **A customer with a password** (optional), to try stored cards and
  subscriptions. Its credentials go in `CL_CUSTOMER_EMAIL` /
  `CL_CUSTOMER_PASSWORD`.
- **A subscription model** on the market with the frequencies to offer
  (optional), for subscriptions that charge on their own.

### Quick start: seed a new organization (optional)

For a quick try, create a new organization and let the
[Commerce Layer CLI](https://github.com/commercelayer/commercelayer-cli) and its
[seeder plugin](https://github.com/commercelayer/commercelayer-cli-plugin-seeder)
fill it with markets, SKUs and prices. A new organization already comes with a
sales channel and an integration application. Log in with the integration
application's client ID and secret, from the dashboard (`-a` is just the alias
the CLI saves them under):

```bash
npm install -g @commercelayer/cli
commercelayer app:login -i <client_id> -s <client_secret> -o <org_slug> -a admin
commercelayer plugins:install seeder
commercelayer seed
```

Then:

1. In the dashboard, create the payment settings you want to try and add them
   to the market you will use.
2. Fill in `.env.local` as described below: the sales channel's client ID in
   `CL_CLIENT_ID`, the same integration credentials you logged in with in
   `CL_INTEGRATION_CLIENT_ID` / `CL_INTEGRATION_CLIENT_SECRET`, and the code of
   that market in `CL_MARKET_CODE`.

## Configure and run

```bash
pnpm install
cp .env.local.example .env.local   # then fill it in
pnpm dev                           # http://localhost:3000
```

`.env.local.example` documents every variable, grouped by feature. In short:

| Group | Variables | Without them |
|---|---|---|
| Required | `CL_CLIENT_ID`, `CL_MARKET_CODE` | The app doesn't start |
| Organization domain | `CL_DOMAIN` | The default Commerce Layer domain |
| Store page | `CL_SKU_CODE`, `CL_ADDRESS_COUNTRY_CODE`, `CL_CUSTOMER_EMAIL`, `CL_CUSTOMER_PASSWORD` | The first priced SKU, a US address, no customer login |
| Integration application | `CL_INTEGRATION_CLIENT_ID`, `CL_INTEGRATION_CLIENT_SECRET` | No express buttons, no debug panels, Adyen's advanced flow fails. The store page says so |
| Debug panels | `CL_DEBUG_PANELS` | Panels off in a production build (always on in `pnpm dev`) |
| Adyen express | `CL_APPLE_PAY_MERCHANT_ID`, `CL_APPLE_PAY_MERCHANT_NAME`, `CL_EXPRESS_COUNTRY_CODE` | No Adyen Apple Pay button |
| Mollie | `MOLLIE_API_KEY`, `GATEWAY_SHARED_SECRET`, `CL_WEBHOOK_ENDPOINT_URL`, `APP_URL` | Mollie payments don't work |
| Debugging | `NEXT_PUBLIC_CL_DEBUG_REQUESTS`, `DEV_TUNNEL_HOST` | No request logging, no tunnel |

Apple Pay and Google Pay only show up on a browser and device that support
them, and Apple Pay needs a domain verified with Apple, so express payments
generally need a deploy or a tunnel rather than `localhost`.

### Debug panels

The order page can show three debug panels: gift cards (create and delete test
cards), the order's payment sessions with their transactions, and whether the
order can be placed. They are always on in `pnpm dev`. A production build only
shows them with `CL_DEBUG_PANELS=1`, since they act with the integration
application's credentials.

### Mollie

Mollie is connected as an external payment setting: Commerce Layer calls this
app's routes, which talk to Mollie. Commerce Layer and Mollie both have to reach
the app, so run it on a public URL (a deploy, or a tunnel with
`DEV_TUNNEL_HOST` and `APP_URL` set to it). On the external payment setting:

- `session_url`: `<APP_URL>/api/gateway/session`
- `authorization_url`: `<APP_URL>/api/gateway/authorize`
- `capture_url`: `<APP_URL>/api/gateway/capture`
- `void_url` and `refund_url`: required by the API, but the playground
  implements neither
- `external_includes`: the payment session. The authorize route reads the
  Mollie payment ID from the included `payment_sessions` resource
- `shared_secret`: the same value as `GATEWAY_SHARED_SECRET`. The routes refuse
  every call without it.

Then copy the setting's `webhook_endpoint_url` into `CL_WEBHOOK_ENDPOINT_URL`:
the app forwards Mollie's status changes there.

## Why not a public deploy

The playground favors showing the API over guarding it. On a public URL:

- the debug panels, when on, let any visitor create and delete gift cards and
  read the organization's payment sessions;
- the server actions behind Adyen's advanced flow (`src/gateways/adyen/actions.ts`)
  take an order or session ID from the browser and act on it with the
  integration application's credentials. They can't be switched off, since
  the Adyen card flow needs them.

Keep it on your machine, or behind access control.

## End-to-end tests

`tests/e2e/` holds a Playwright suite (`pnpm test:e2e`). It is an internal
suite: it runs against our own sandbox organization and relies on its SKU,
prices, subscription model and gateway accounts, so it isn't expected to pass
against another organization. It is still a useful reference for driving the
gateways' forms. See [`tests/e2e/README.md`](tests/e2e/README.md).

## License

[MIT](LICENSE)
