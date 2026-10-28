import { cancelCustomerDataSince } from "./integration-api"

/**
 * Every run saves cards and starts weekly subscriptions for the e2e customer,
 * and an active subscription keeps renewing in the sandbox long after the run.
 * The teardown returned here cancels what the run left behind, by creation
 * time, so nothing that existed before the run is touched.
 *
 * Specs that pay with a saved card therefore rely on one saved earlier in the
 * same run. Set `E2E_KEEP_DATA=1` to skip the cleanup, e.g. to inspect a failed
 * run.
 */
export default async function globalSetup() {
  const startedAt = new Date()
  return async () => {
    if (process.env.E2E_KEEP_DATA) return
    const { subscriptions, wallets, failed } =
      await cancelCustomerDataSince(startedAt)
    console.log(
      `e2e cleanup: cancelled ${subscriptions} order subscriptions and ${wallets} payment wallets`,
    )
    if (failed.length) {
      console.warn(`e2e cleanup: could not cancel\n  ${failed.join("\n  ")}`)
    }
  }
}
