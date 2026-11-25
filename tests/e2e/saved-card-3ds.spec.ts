import { CheckoutPage } from "./checkout-page"
import { expect, test } from "./fixtures"

/**
 * 3-D Secure when paying with a saved card.
 *
 * Each test stores a card that asks for authentication on every payment, then
 * pays with it again from the saved cards list. The second challenge is the
 * point: it runs through the wallet path, which the other saved-card specs
 * never reach because their cards authorize without one.
 */

/** Stripe's test card that requires authentication on every payment. */
const STRIPE_3DS_CARD = "4000002760003184"

/** Checkout.com's test card that the sandbox issuer challenges. */
const CHECKOUT_COM_3DS_CARD = "4242424242424242"

/** Adyen's 3DS2 test card: device fingerprint first, then a challenge. */
const ADYEN_3DS_CARD = "4917610000000000"

test("pays again with a saved Stripe card after a 3-D Secure challenge", async ({
  page,
}) => {
  const checkout = new CheckoutPage(page)
  await checkout.loginAsCustomer()
  await checkout.create()

  await checkout.selectMethod("payment_setting_stripes")
  await page.getByRole("checkbox", { name: "Save card for future use" }).check()
  await checkout.confirm()
  await expect(checkout.stripeCardNumber()).toBeVisible()
  await checkout.fillStripeTestCard(STRIPE_3DS_CARD)
  await checkout.authorize()
  await checkout.completeStripeChallenge()
  await checkout.expectPlaced()

  // The wallet is linked when CL processes the authorization, which can land
  // a little after placement.
  const savedCard = checkout.savedCardRow(/stripe/i, STRIPE_3DS_CARD.slice(-4))
  await expect
    .poll(
      async () => {
        await checkout.create()
        return savedCard.count()
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0)

  await savedCard.getByRole("button", { name: "Pay", exact: true }).click()
  await checkout.completeStripeChallenge()
  await checkout.expectPlaced()

  // Other specs pay with the customer's newest saved Stripe card and don't
  // expect a challenge, so don't leave this one at the top of the list.
  await checkout.create()
  await savedCard.getByRole("button", { name: "Remove saved card" }).click()
  await expect(savedCard).toHaveCount(0)
})

test("pays again with a saved Adyen card after a 3-D Secure challenge", async ({
  page,
}) => {
  const checkout = new CheckoutPage(page)
  await checkout.loginAsCustomer()
  await checkout.create()

  await checkout.selectMethod("payment_setting_adyens")
  await checkout.useAdyenAdvancedCard()
  await checkout.confirm()
  await checkout.payWithAdyenAdvancedCard({
    save: true,
    cardNumber: ADYEN_3DS_CARD,
  })
  await checkout.completeAdyenChallenge()
  await checkout.expectPlaced()

  // The advanced flow creates the payment_wallet together with the
  // authorization, so the card is offered on the very next checkout.
  await checkout.create()
  await checkout.payWithSavedAdyenCard({ last4: ADYEN_3DS_CARD.slice(-4) })
  await checkout.completeAdyenChallenge()
  await checkout.expectPlaced()

  // Other specs pay with the customer's newest saved Adyen card and don't
  // expect a challenge, so don't leave this one at the top of the list.
  await checkout.create()
  const savedCard = checkout.savedCardRow(/adyen/i, ADYEN_3DS_CARD.slice(-4))
  await savedCard.getByRole("button", { name: "Remove saved card" }).click()
  await expect(savedCard).toHaveCount(0)
})

test("pays again with a saved Checkout.com card after a 3-D Secure challenge", async ({
  page,
}) => {
  test.setTimeout(150_000)
  const checkout = new CheckoutPage(page)
  await checkout.loginAsCustomer()
  await checkout.create()

  await checkout.selectMethod("payment_setting_checkout_coms")
  await page.getByRole("checkbox", { name: "Save card for future use" }).check()
  await checkout.confirm()
  await checkout.fillCheckoutComTestCard(CHECKOUT_COM_3DS_CARD)
  await checkout.submitCheckoutCom()
  await checkout.completeCheckoutComChallenge()
  await checkout.expectPlaced()

  // The wallet is linked when CL processes the authorization, which can land
  // a little after placement.
  const savedCard = checkout.savedCardRow(
    /checkout\.com/i,
    CHECKOUT_COM_3DS_CARD.slice(-4),
  )
  await expect
    .poll(
      async () => {
        await checkout.create()
        return savedCard.count()
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0)

  // Here the challenge runs on Checkout.com's own page, which then sends the
  // shopper back to the order.
  await savedCard.getByRole("button", { name: "Pay", exact: true }).click()
  await checkout.completeCheckoutComChallenge()
  await checkout.expectPlaced()

  // The card stays saved: the other Checkout.com specs pick their saved card
  // by its last digits, never the newest one.
})

/**
 * A failed challenge on a saved card sends the shopper to the session's
 * `failure_url`. The checkout says so and leaves the order open, without
 * offering that session again: it stays bound to the saved card.
 */
test("a failed 3-D Secure challenge on a saved Checkout.com card leaves the order open", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const checkout = new CheckoutPage(page)
  await checkout.loginAsCustomer()
  await checkout.create()

  // Saved by the test above, in this run or an earlier one.
  const savedCard = checkout.savedCardRow(
    /checkout\.com/i,
    CHECKOUT_COM_3DS_CARD.slice(-4),
  )
  await expect(savedCard).toBeVisible()
  await savedCard.getByRole("button", { name: "Pay", exact: true }).click()
  await checkout.failCheckoutComChallenge()

  await page.waitForURL(/checkout_com_return=failure/, { timeout: 30_000 })
  await expect(
    page.getByText(
      "The payment was not completed. Try again or use another card.",
    ),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page).not.toHaveURL(/checkout_com_return/)
  await expect(page.getByTestId("checkout-com-flow")).toHaveCount(0)
  await expect(
    page.getByRole("radio", { name: /payment_setting_checkout_coms/ }),
  ).not.toBeChecked()
})
