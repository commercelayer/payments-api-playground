import { CheckoutPage } from "./checkout-page";
import { expect, test } from "./fixtures";
import { fetchOrderSubscriptionState } from "./integration-api";

/**
 * Weekly subscription through the full checkout.
 *
 * Covers the two-step shape of the API: the frequency is written onto the line
 * items during checkout, and the order_subscription is only minted after the
 * order is placed. Pays with the manual (wire transfer) setting so the scenario
 * exercises the subscription path without dragging a gateway into it.
 *
 * Requires a `subscription_model` carrying `weekly` on the order's market —
 * without one the API refuses the frequency and the picker cannot be used.
 */
test.describe("subscription checkout", () => {
	// Runs authenticated rather than through the shared `checkout` fixture: a
	// subscription belongs to a customer, so a guest order never produces one.
	test("places a weekly order and creates an active subscription", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectFrequency("Every week");

		// The frequency write rebuilds the shipments, clearing the method the
		// order was created with — without re-picking it, placement fails.
		await checkout.selectFirstShippingMethod();

		await checkout.selectMethod("payment_setting_manuals");
		await checkout.confirm();
		await checkout.expectPlaced();

		// The subscription is created by the patch that follows placement. The
		// status badge is only title-cased by CSS, so match the raw lowercase text.
		const section = checkout.subscriptionSection();
		await expect(section.getByText("active", { exact: true })).toBeVisible({
			timeout: 45_000,
		});
		await expect(
			section.getByText("Every week", { exact: true }).first(),
		).toBeVisible();
		await expect(section.getByText("Next run")).toBeVisible();
	});

	test("manages the subscription when the order is reopened", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectFrequency("Every week");
		await checkout.selectFirstShippingMethod();
		await checkout.selectMethod("payment_setting_manuals");
		await checkout.confirm();
		await checkout.expectPlaced();

		const section = checkout.subscriptionSection();
		await expect(section.getByText("active", { exact: true })).toBeVisible({
			timeout: 45_000,
		});

		// Reopening the placed order has to bring the subscription back with its
		// controls — that is the only way to reach it once checkout is over.
		const orderUrl = page.url();
		await page.goto(orderUrl);
		await expect(section.getByText("active", { exact: true })).toBeVisible({
			timeout: 45_000,
		});

		// Reschedule: next_run_at accepts any future moment.
		const target = new Date(Date.now() + 30 * 24 * 3600 * 1000);
		target.setSeconds(0, 0);
		const pad = (n: number) => String(n).padStart(2, "0");
		const localValue = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
		await checkout.reschedule(localValue);
		await expect(checkout.nextRunText()).toContainText(
			String(target.getFullYear()),
		);
		await expect(checkout.nextRunText()).toContainText(pad(target.getDate()));

		// Cancelling is the way to stop it for good.
		await checkout.cancelSubscription();
		await expect(section.getByText("cancelled", { exact: true })).toBeVisible({
			timeout: 45_000,
		});
		await expect(
			section.getByRole("button", { name: "Cancel", exact: true }),
		).toHaveCount(0);
	});

	test("never lets a guest create a subscription", async ({ page }) => {
		const checkout = new CheckoutPage(page);
		await checkout.logoutCustomer();
		await checkout.create();
		const orderId = page.url().split("/").pop() ?? "";

		// Nothing to pick and nothing to explain — the section is not rendered,
		// which is what closes both the frequency picker and the create retry.
		await expect(checkout.subscriptionSection()).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Every week", exact: true }),
		).toHaveCount(0);

		// The third way in is the trigger that rides on `_place`. Going all the
		// way through checkout is what proves it stayed off: the order is read
		// back with an integration token, so a subscription created behind the
		// storefront's back would still show up there.
		await checkout.selectMethod("payment_setting_manuals");
		await checkout.confirm();
		await checkout.expectPlaced();

		const state = await fetchOrderSubscriptionState(orderId);
		expect(state.status).toBe("placed");
		expect(state.seededSubscriptions).toHaveLength(0);
		expect(state.generatedBy).toBeNull();
		expect(state.frequencies).toHaveLength(0);
	});

	test("withholds payment until a shipping method is chosen again", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		// The order arrives with a shipping method already picked, so payment is open.
		await expect(checkout.addPaymentHeading).toBeVisible();

		// Writing the frequency rebuilds the shipments and drops that method. The
		// order total loses the shipping cost with it, so payment has to close —
		// leaving Place Order reachable here is what let a short payment through.
		await checkout.selectFrequency("Every week");
		await expect(
			page.getByText("Choose a shipping method above to continue to payment."),
		).toBeVisible();
		await expect(checkout.addPaymentHeading).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Place Order" })).toHaveCount(
			0,
		);

		// Picking one again reopens it.
		await checkout.selectFirstShippingMethod();
		await expect(checkout.addPaymentHeading).toBeVisible();
	});

	test("pauses and restarts a subscription", async ({ page }) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectFrequency("Every week");
		await checkout.selectFirstShippingMethod();
		await checkout.selectMethod("payment_setting_manuals");
		await checkout.confirm();
		await checkout.expectPlaced();

		const section = checkout.subscriptionSection();
		await expect(section.getByText("active", { exact: true })).toBeVisible({
			timeout: 45_000,
		});

		// Pausing keeps the subscription but stops it running.
		await checkout.setSubscriptionRunning(false);
		await expect(section.getByText("inactive", { exact: true })).toBeVisible();
		await expect(section.getByText(/Not running/)).toBeVisible();

		// …and it is reversible, unlike cancelling.
		await checkout.setSubscriptionRunning(true);
		await expect(section.getByText("active", { exact: true })).toBeVisible();
		await expect(section.getByText(/Not running/)).toHaveCount(0);
	});

	test("makes saving the card mandatory on a recurring order", async ({
		page,
	}) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		// One-off: the shopper chooses whether to keep the card.
		await checkout.selectMethod("payment_setting_stripes");
		const saveCheckbox = page.getByRole("checkbox", {
			name: "Save card for future use",
		});
		await expect(saveCheckbox).toBeVisible();

		// Recurring: the choice goes away, because a subscription with no stored
		// card is created and then never runs.
		await checkout.selectFrequency("Every week");
		await checkout.selectFirstShippingMethod();
		await checkout.selectMethod("payment_setting_stripes");
		await expect(saveCheckbox).toHaveCount(0);
		await expect(page.getByText(/This card will be saved/)).toBeVisible();
	});

	test("leaves a one-off order without a subscription", async ({ page }) => {
		const checkout = new CheckoutPage(page);
		await checkout.loginAsCustomer();
		await checkout.create();

		await checkout.selectMethod("payment_setting_manuals");
		await checkout.confirm();
		await checkout.expectPlaced();

		await expect(
			checkout.subscriptionSection().getByText("placed as a one-off"),
		).toBeVisible();
	});
});
