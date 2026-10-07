import { expect, type Locator, type Page } from "@playwright/test";
import { raiseOrderTotalTo } from "./integration-api";

/**
 * Page Object for the checkout (`/orders/[id]`) — the reusable entry point for
 * payment e2e scenarios.
 *
 * `create()` is the shared setup: it places a fresh order via the home
 * "Checkout" button and lands on the order page with the "Add payment" block
 * ready for payment selection. Everything else (selecting a method, confirming,
 * paying with Stripe, asserting placement) is exposed as small helpers so new
 * scenarios — gift cards, multiple payments — can build on the same object.
 */
export class CheckoutPage {
	constructor(readonly page: Page) {}

	/** Heading of the "Add payment" block — present once the page is ready for selection. */
	get addPaymentHeading(): Locator {
		return this.page.getByText("Add payment", { exact: true });
	}

	/** All payment-method radios in the "Add payment" block. */
	paymentMethodOptions(): Locator {
		return this.page.locator('input[name="payment_method"]');
	}

	/** The amount field (auto-filled with the remaining balance on method select). */
	amountInput(): Locator {
		return this.page.getByPlaceholder("Amount");
	}

	/**
	 * Stripe Elements card iframe (only present once a Stripe session exists).
	 * The PaymentElement renders several iframes; the card inputs (name=number /
	 * expiry / cvc, no aria-labels) live in this one.
	 */
	stripeCardFrame() {
		return this.page.frameLocator(
			'iframe[src*="elements-inner-accessory-target"]',
		);
	}

	/** The Stripe card-number field — appears only once a Stripe session exists. */
	stripeCardNumber(): Locator {
		return this.stripeCardFrame().locator('input[name="number"]');
	}

	/**
	 * Log in as the demo customer from the store home. Saved cards are listed per
	 * customer, and the checkout only offers subscriptions to one, so scenarios
	 * covering either have to run authenticated rather than as a guest.
	 */
	async loginAsCustomer(): Promise<void> {
		await this.page.goto("/");
		const login = this.page.getByRole("button", { name: "Login as customer" });
		if (await login.count()) {
			await login.click();
			await expect(this.page.getByText("Logged in as customer")).toBeVisible();
		}
	}

	/** Log out, returning to a guest session. */
	async logoutCustomer(): Promise<void> {
		await this.page.goto("/");
		const logout = this.page.getByRole("button", { name: "Logout" });
		if (await logout.count()) {
			await logout.click();
			await expect(this.page.getByText("Guest session")).toBeVisible();
		}
	}

	/** The checkout's "Subscription" section. */
	subscriptionSection(): Locator {
		return this.page.locator("section").filter({
			has: this.page.getByRole("heading", { name: "Subscription" }),
		});
	}

	/**
	 * Choose how often the order repeats, and wait for the write to land.
	 *
	 * Waits on the button's `aria-pressed`, which is driven by the frequency on
	 * the refreshed order rather than by the click. That matters: writing the
	 * frequency rebuilds the shipments, so a caller that picks a shipping method
	 * before this settles picks it on the shipment about to be replaced.
	 */
	async selectFrequency(label: string): Promise<void> {
		const button = this.subscriptionSection().getByRole("button", {
			name: label,
			exact: true,
		});
		await button.click();
		await expect(button).toHaveAttribute("aria-pressed", "true");
	}

	/** A subscription row's reschedule field (a `datetime-local` input). */
	nextRunInput(): Locator {
		return this.subscriptionSection().locator('input[type="datetime-local"]');
	}

	/** The rendered "Next run" value of the first subscription row. */
	nextRunText(): Locator {
		return this.subscriptionSection()
			.getByText("Next run")
			.locator("xpath=following-sibling::dd[1]");
	}

	/**
	 * Move the next charge. `fill` writes a `datetime-local` in its value format
	 * (`YYYY-MM-DDTHH:mm`) regardless of the locale the field renders in.
	 */
	async reschedule(localValue: string): Promise<void> {
		await this.nextRunInput().fill(localValue);
		await this.subscriptionSection()
			.getByRole("button", { name: "Set", exact: true })
			.click();
	}

	/** Pause or start the first subscription on the order. */
	async setSubscriptionRunning(running: boolean): Promise<void> {
		await this.subscriptionSection()
			.getByRole("button", { name: running ? "Start" : "Pause", exact: true })
			.click();
	}

	/** Cancel the first subscription on the order. */
	async cancelSubscription(): Promise<void> {
		await this.subscriptionSection()
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
	}

	/** The "Remaining" figure in the "Add payment" block, in cents. */
	async remainingAmountCents(): Promise<number> {
		const text = await this.page.getByText(/^Remaining: /).innerText();
		return Math.round(parseFloat(text.replace(/[^0-9.]/g, "")) * 100);
	}

	/** The Shipping row of the order totals, in cents. */
	async shippingAmountCents(): Promise<number> {
		const amount = this.page
			.getByText("Shipping", { exact: true })
			.first()
			.locator("xpath=following-sibling::span[1]");
		const text = await amount.innerText();
		return Math.round(parseFloat(text.replace(/[^0-9.]/g, "")) * 100) || 0;
	}

	/**
	 * Pick the first unselected shipping method. Needed after any line item write,
	 * which rebuilds the shipments and clears the method already chosen.
	 *
	 * Waits for the shipping cost to be back in the totals before returning. The
	 * amount field is auto-filled from the remaining balance when a payment method
	 * is picked, so a caller that moves on too early pays the pre-shipping total
	 * and leaves the order short of its own total. Waiting on the shipping row
	 * specifically, not on remaining-equals-total: those two agree both before the
	 * refresh and after it, so they cannot tell the two states apart.
	 */
	async selectFirstShippingMethod(): Promise<void> {
		const radios = this.page.locator('input[name^="shipping_method_"]');
		// The shipment list is briefly empty while the order refreshes.
		await expect(radios.first()).toBeVisible();
		const count = await radios.count();
		for (let i = 0; i < count; i++) {
			const radio = radios.nth(i);
			if (!(await radio.isChecked())) {
				await radio.check();
				break;
			}
		}
		await expect
			.poll(async () => await this.shippingAmountCents())
			.toBeGreaterThan(0);
		await expect
			.poll(
				async () =>
					(await this.remainingAmountCents()) ===
					(await this.orderTotalCents()),
			)
			.toBe(true);
	}

	/**
	 * Setup: create an order from the store home and wait for the checkout to be
	 * ready for payment selection.
	 */
	async create(): Promise<void> {
		await this.page.goto("/");
		// The home page shows the shippable SKU first and, below it, a digital
		// do-not-ship SKU whose card carries an identical "Checkout" button.
		// Payment scenarios want the shippable order, so take the first one.
		await this.page.getByRole("button", { name: "Checkout" }).first().click();
		await this.page.waitForURL(/\/orders\/.+/);
		await expect(this.addPaymentHeading).toBeVisible();
	}

	/** The debug "Gift Cards" panel (the only section with a code input). */
	giftCardDebugSection(): Locator {
		return this.page
			.locator("section")
			.filter({ has: this.page.locator('input[name="code"]') });
	}

	/**
	 * Create a gift card via the debug panel (created + purchased + activated in
	 * the market currency) and wait for it to appear in the list.
	 */
	async createGiftCard(code: string, amount: number): Promise<void> {
		const section = this.giftCardDebugSection();
		await section.locator('input[name="code"]').fill(code);
		await section.locator('input[name="amount"]').fill(String(amount));
		await section.getByRole("button", { name: "Create" }).click();
		await expect(section.getByText(code, { exact: true })).toBeVisible({
			timeout: 20_000,
		});
	}

	/** The checkout "Gift cards" code entry (the debug panel's field is name="code"). */
	giftCardInput(): Locator {
		return this.page.getByPlaceholder("Gift card code");
	}

	/**
	 * An applied gift-card row in the checkout gift-card list. Matched by the row's
	 * "Remove" control (the debug creation panel lists the same code but has no
	 * "Remove"), so this uniquely targets the applied card even with several
	 * applied at once.
	 */
	appliedGiftCard(code: string): Locator {
		return this.page
			.locator("li")
			.filter({ has: this.page.getByRole("button", { name: "Remove" }) })
			.filter({ hasText: code });
	}

	/**
	 * The covered/remaining counter, shown once something covers part of the
	 * order. Anchored on "Covered" so it matches the line itself and not the
	 * section wrapping it.
	 */
	giftCardCounter(): Locator {
		return this.page.getByText(/^Covered /);
	}

	/** Submit a gift card code without waiting for it to be accepted. */
	async submitGiftCard(code: string): Promise<void> {
		await this.giftCardInput().fill(code);
		await this.page.getByRole("button", { name: "Apply" }).click();
	}

	/**
	 * Apply a gift card code to the order via the checkout "Gift cards" section.
	 * Waits for the specific code to appear in the applied list so multiple gift
	 * cards can be applied without tripping strict-mode on a shared control.
	 */
	async applyGiftCard(code: string): Promise<void> {
		await this.submitGiftCard(code);
		await expect(this.appliedGiftCard(code)).toBeVisible();
	}

	/**
	 * Override the auto-filled amount (default is the full remaining balance).
	 * Used to split a payment across methods — e.g. paying only part of the
	 * remaining balance with one method before covering the rest with another.
	 */
	async setAmount(amount: number): Promise<void> {
		await this.amountInput().fill(String(amount));
	}

	/**
	 * Wait until a partial payment has been authorized and locked in — the
	 * "Authorized payments" block appears once the session list refreshes, which
	 * also means the remaining balance (and the next auto-filled amount) is
	 * up to date.
	 */
	async expectAuthorizedPayment(): Promise<void> {
		await expect(
			this.page.getByText("Authorized payments", { exact: true }),
		).toBeVisible({ timeout: 45_000 });
	}

	/**
	 * The order total, in cents, read from the Total row. Tests derive gift card
	 * amounts from it rather than hard-coding a figure the catalog can change.
	 */
	async orderTotalCents(): Promise<number> {
		const amount = this.page
			.getByText("Total", { exact: true })
			.first()
			.locator("xpath=following-sibling::span[1]");
		const text = await amount.innerText();
		return Math.round(parseFloat(text.replace(/[^0-9.]/g, "")) * 100);
	}

	/** Remove an applied gift card and wait for its row to go. */
	async removeGiftCard(code: string): Promise<void> {
		await this.appliedGiftCard(code)
			.getByRole("button", { name: "Remove" })
			.click();
		await expect(this.appliedGiftCard(code)).toHaveCount(0);
	}

	/** All shipping-method radios, across every shipment on the order. */
	shippingMethodOptions(): Locator {
		return this.page.locator('input[type="radio"][name^="shipping_method_"]');
	}

	/**
	 * Switch to a shipping method other than the selected one, which re-prices
	 * the order. Resolves with the new total once the Total row has actually
	 * moved, so callers can assume the re-price has landed.
	 */
	async selectOtherShippingMethod(): Promise<number> {
		const before = await this.orderTotalCents();
		const options = this.shippingMethodOptions();
		for (let i = 0; i < (await options.count()); i++) {
			const option = options.nth(i);
			if (await option.isChecked()) continue;
			await option.check();
			await expect
				.poll(async () => this.orderTotalCents(), { timeout: 30_000 })
				.not.toBe(before);
			return this.orderTotalCents();
		}
		throw new Error("No alternative shipping method to switch to.");
	}

	/** Place the order (only offered once the remaining balance is zero). */
	async placeOrder(): Promise<void> {
		await this.page.getByRole("button", { name: "Place Order" }).click();
	}

	/** Select a payment method by its CL type (e.g. "payment_setting_stripes"). */
	async selectMethod(type: string): Promise<void> {
		const row = this.page
			.locator("label")
			.filter({ has: this.page.getByText(type, { exact: true }) });
		await row.locator('input[type="radio"]').check();
	}

	async confirm(): Promise<void> {
		await this.page.getByRole("button", { name: "Confirm" }).click();
	}

	/**
	 * Fill the Stripe Elements card form with a test card that authorizes
	 * successfully. Types (rather than `fill`s) into each field so Stripe's input
	 * handlers fire and the field registers as complete — otherwise Authorize can
	 * fire `confirmPayment` against a still-"incomplete" card.
	 */
	async fillStripeTestCard(): Promise<void> {
		const frame = this.stripeCardFrame();
		const type = async (name: string, value: string) => {
			const input = frame.locator(`input[name="${name}"]`);
			await input.click();
			await input.pressSequentially(value, { delay: 20 });
		};

		await type("number", "4242424242424242");
		await type("expiry", "1234");
		await type("cvc", "123");

		// Some Stripe configurations also ask for a postal/ZIP code.
		const zip = frame.locator('input[name="postalCode"]');
		if (await zip.count()) await type("postalCode", "12345");

		// Make sure the card number stuck before authorizing (Stripe formats it).
		await expect(frame.locator('input[name="number"]')).toHaveValue(/4242/);
	}

	async authorize(): Promise<void> {
		const button = this.page.getByRole("button", { name: "Authorize" });
		// The button is disabled until the CL session's client_secret lands in
		// response_data (async in multi-payment flows with gift cards). Scroll it
		// into view first to shift Playwright's context out of the Stripe iframe
		// after fillStripeTestCard, then wait for enabled before clicking.
		await button.scrollIntoViewIfNeeded();
		await expect(button).toBeEnabled();
		await button.click();
	}

	/**
	 * The Drop-in's new-card entry. Stored cards are mounted alongside it, each
	 * with a security-code field of its own, so fields are looked up in here.
	 */
	private adyenCardForm(): Locator {
		return this.page
			.locator(".adyen-dropin-container .adyen-checkout__payment-method")
			.filter({ has: this.page.locator(".adyen-checkout__field--cardNumber") });
	}

	/** A field inside an Adyen card form (each lives in its own iframe). */
	private adyenField(form: Locator, field: string, label: string): Locator {
		return form
			.frameLocator(`.adyen-checkout__field--${field} iframe`)
			.getByRole("textbox", { name: label });
	}

	/**
	 * Type one Adyen secured field and make sure the value actually landed.
	 *
	 * These are cross-origin iframes driven by real key events, and under load
	 * some of those keystrokes get dropped: the field keeps a partial value, the
	 * script moves on to the next one, and the payment fails much later with
	 * nothing pointing back at the cause. Adyen marks a complete field with
	 * `adyen-checkout__field--valid`, so wait for that and retype from scratch if
	 * it does not appear — retyping, not appending, because a dropped keystroke
	 * can land anywhere in the value.
	 */
	private async fillAdyenField(
		form: Locator,
		field: string,
		label: string,
		value: string,
	): Promise<void> {
		const wrapper = form.locator(`.adyen-checkout__field--${field}`);
		const input = this.adyenField(form, field, label);

		for (let attempt = 1; attempt <= 3; attempt++) {
			await input.click();
			// Clear whatever a dropped keystroke left behind. The read-back is
			// formatted ("4988 4388 …"), so its length covers the separators too.
			const current = await input.inputValue().catch(() => "");
			for (let i = 0; i < current.length; i++) await input.press("Backspace");

			await input.pressSequentially(value, { delay: 30 });
			try {
				await expect(wrapper).toHaveClass(/adyen-checkout__field--valid/, {
					timeout: 3_000,
				});
				return;
			} catch (e) {
				// Let the last attempt report the real assertion failure.
				if (attempt === 3) throw e;
			}
		}
	}

	/**
	 * Fill the Adyen Drop-in card form (the "Cards" method is auto-selected). Types
	 * into the secured fields — like Stripe, they're encrypted iframes that need
	 * real key events, not `fill`.
	 */
	async fillAdyenTestCard(): Promise<void> {
		// For a logged-in shopper with cards already stored on Adyen, the Drop-in
		// opens on one of those instead of the new-card form, so open "Cards".
		// Stored cards render with the same classes as the new-card entry, so it is
		// told apart by its title.
		const dropin = this.page.locator(".adyen-dropin-container");
		await expect(
			dropin.locator(".adyen-checkout__payment-method__header").first(),
		).toBeVisible();
		if (
			!(await dropin.locator(".adyen-checkout__field--cardNumber").isVisible())
		) {
			await dropin
				.locator(".adyen-checkout__payment-method__header")
				.filter({ hasText: /^Cards$/ })
				.click();
		}

		await this.fillAdyenCard(this.adyenCardForm());
	}

	/** Type Adyen's test card into a card form. */
	private async fillAdyenCard(form: Locator): Promise<void> {
		await this.fillAdyenField(
			form,
			"cardNumber",
			"Card number",
			"4988438843884305",
		);
		await this.fillAdyenField(form, "expiryDate", "Expiry date", "0330");
		await this.fillAdyenField(form, "securityCode", "Security code", "737");
	}

	/** The advanced-flow Card Component, mounted on its own without a session. */
	private adyenAdvancedCard(): Locator {
		return this.page.locator(".adyen-advanced-card-container");
	}

	/** Pick Adyen's advanced flow (Card Component) instead of the Drop-in. Must
	 * happen before Confirm, which decides which widget is mounted. */
	async useAdyenAdvancedCard(): Promise<void> {
		await this.page
			.getByLabel("Advanced flow (Card Component) — instead of the Drop-in")
			.check();
	}

	/**
	 * Fill and submit the advanced-flow card. `save` ticks the component's own
	 * "save card" checkbox, which is only rendered for a logged-in shopper on a
	 * one-off order.
	 */
	async payWithAdyenAdvancedCard({ save = false } = {}): Promise<void> {
		const form = this.adyenAdvancedCard();
		await expect(
			form.locator(".adyen-checkout__field--cardNumber"),
		).toBeVisible();
		await this.fillAdyenCard(form);
		if (save) {
			// Adyen hides the native input behind a styled label: tick it through
			// the label and read the state back from the input.
			await form.locator(".adyen-checkout__checkbox").first().click();
			await expect(form.getByRole("checkbox", { name: /save/i })).toBeChecked();
		}
		await form.getByRole("button", { name: /pay/i }).click();
	}

	/**
	 * Pay with the most recent card stored with Adyen. The merchant keeps
	 * Adyen's CVC-required policy for stored cards on, so the CVC is entered
	 * again before paying.
	 */
	async payWithSavedAdyenCard(): Promise<void> {
		const row = this.page
			.locator("li")
			.filter({ hasText: /adyen/i })
			.filter({
				has: this.page.getByRole("button", { name: "Pay", exact: true }),
			})
			.first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.getByRole("button", { name: "Pay", exact: true }).click();

		const form = this.page.locator(".adyen-cvc-container");
		await expect(
			form.locator(".adyen-checkout__field--securityCode"),
		).toBeVisible();
		await this.fillAdyenField(form, "securityCode", "Security code", "737");
		await form.getByRole("button", { name: /pay/i }).click();
	}

	/** The input inside one Braintree Hosted Field (each lives in its own iframe). */
	private braintreeField(field: string): Locator {
		return (
			this.page
				.frameLocator(`iframe[name="braintree-hosted-field-${field}"]`)
				// Each frame also carries hidden autofill inputs; the visible one is
				// tagged with the field name.
				.locator(`input[data-braintree-name="${field}"]`)
		);
	}

	/**
	 * Type one Braintree Hosted Field and make sure the value actually landed.
	 *
	 * Same cross-origin iframe problem as Adyen's secured fields: keystrokes can
	 * get dropped under load, leaving a partial value that only surfaces much
	 * later as a failed tokenize. Braintree adds `braintree-hosted-fields-valid`
	 * to the container it mounted the field in, so wait for that and retype from
	 * scratch if it does not appear.
	 */
	private async fillBraintreeField(
		field: string,
		value: string,
	): Promise<void> {
		const container = this.page.locator(
			`div:has(> iframe[name="braintree-hosted-field-${field}"])`,
		);
		const input = this.braintreeField(field);

		for (let attempt = 1; attempt <= 3; attempt++) {
			await input.click();
			const current = await input.inputValue().catch(() => "");
			for (let i = 0; i < current.length; i++) await input.press("Backspace");

			await input.pressSequentially(value, { delay: 30 });
			try {
				await expect(container).toHaveClass(/braintree-hosted-fields-valid/, {
					timeout: 3_000,
				});
				return;
			} catch (e) {
				// Let the last attempt report the real assertion failure.
				if (attempt === 3) throw e;
			}
		}
	}

	/**
	 * Switch Braintree to the Drop-in UI. The toggle is only offered before
	 * Confirm, since it decides which widget the new session is shown in.
	 */
	async useBraintreeDropin(): Promise<void> {
		await this.page.getByLabel("Drop-in UI — instead of Hosted Fields").check();
	}

	/**
	 * Fill the Braintree card fields, whether they come from Hosted Fields or the
	 * Drop-in (which mounts the same hosted-field iframes). The default card makes
	 * the issuer ask for a 3-D Secure challenge (complete it with
	 * `completeBraintreeChallenge`); `4000000000001000` authenticates
	 * frictionlessly.
	 */
	async fillBraintreeTestCard(number = "4005519200000004"): Promise<void> {
		await expect(
			this.page.locator('iframe[name="braintree-hosted-field-number"]'),
		).toBeVisible({ timeout: 30_000 });
		await this.fillBraintreeField("cardholderName", "John Doe");
		await this.fillBraintreeField("number", number);
		await this.fillBraintreeField("expirationDate", "1230");
		// Hosted Fields always mount CVV because the step asks for it. The Drop-in
		// only shows it when the merchant account's rules require one.
		const cvv = this.page.locator('iframe[name="braintree-hosted-field-cvv"]');
		if (await cvv.isVisible()) await this.fillBraintreeField("cvv", "123");
	}

	/**
	 * Complete the sandbox issuer's 3-D Secure challenge. Cardinal mounts it in a
	 * modal iframe, and the sandbox prints the one-time code (1234) on the page.
	 */
	async completeBraintreeChallenge(code = "1234"): Promise<void> {
		const challenge = this.page.frameLocator("#Cardinal-CCA-IFrame");
		const input = challenge.getByPlaceholder("Enter Code Here");
		await expect(input).toBeVisible({ timeout: 30_000 });
		await input.fill(code);
		await challenge.getByRole("button", { name: "SUBMIT" }).click();
	}

	/**
	 * Raise the shirt quantity through the API until the order total reaches
	 * `minCents`, then reload the checkout and restore the shipping method the
	 * line item write dropped. Braintree's sandbox decides the outcome from the
	 * amount (2000.00–2999.99 is a processor decline), so a decline scenario
	 * needs an order priced into that band.
	 */
	async raiseTotalTo(minCents: number): Promise<void> {
		const orderId = new URL(this.page.url()).pathname.split("/").pop();
		if (!orderId) throw new Error("Not on an order page.");
		await raiseOrderTotalTo(orderId, minCents);
		await this.page.reload();
		await this.selectFirstShippingMethod();
	}

	/** Submit the Adyen Drop-in (its own "Pay" button drives authorization). */
	async submitAdyen(): Promise<void> {
		await this.page
			.locator(".adyen-dropin-container")
			.getByRole("button", { name: /pay/i })
			.click();
	}

	/**
	 * Wait until the order reaches a placed state. Placement runs through
	 * `pollAndPlace` (retries waiting on the provider webhook), so this is given a
	 * generous timeout.
	 */
	async expectPlaced(): Promise<void> {
		await expect(
			this.page.getByText(/^(placed|approved)$/, { exact: true }).first(),
		).toBeVisible({ timeout: 45_000 });
	}
}
