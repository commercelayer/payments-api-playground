"use client";

/**
 * PaymentSection — the checkout's payment step, on the CL payments API.
 *
 * Each gateway's integration lives in its own module under src/gateways/
 * (stripe, adyen, braintree, mollie, manual): read one of them to see how that
 * gateway goes from the shopper's choice to an authorized payment_session. The
 * contract between this component and a module is `GatewayPaymentProps`
 * (src/gateways/types.ts). This component holds what every gateway shares:
 *
 *  1. Gift cards  — applied before choosing a payment method; they reduce the
 *                   remaining balance immediately.  Their payment_sessions are
 *                   authorized right before the method's own authorization
 *                   (or at place-order time when they cover everything).
 *                   Several can be stacked: only the first one on an uncovered
 *                   order lets the API size the session, the rest carry the
 *                   remaining balance explicitly, and each is re-checked after
 *                   creation since a card is only worth its actual balance.
 *
 *  2. Partial payments — methods can be combined freely.  Each authorized
 *                   payment_session chips away at the remaining balance.  The
 *                   order is placed as soon as the balance hits zero.
 *
 *  3. Saved cards — succeeded payment_wallets of the logged-in customer are
 *                   offered as one-click "Saved cards".  Paying with one is
 *                   gateway-specific (stripe/pay-with-wallet.ts,
 *                   adyen/saved-card-payment.tsx).  Storing a card happens
 *                   inside each gateway's flow, through the session's
 *                   `vaulting` flag.
 *
 *  4. Redirect returns — a gateway that sends the shopper off-site (Amazon Pay
 *                   through Stripe, Mollie, an Adyen 3-D Secure redirect)
 *                   resumes in its redirect-return.ts; this component then
 *                   places the order.
 *
 *  5. Re-price — when the order total moves, the sessions holding no money are
 *                   rebuilt for the new total.
 *
 * After the order is placed the component switches to a read-only audit view
 * that shows every session, authorization, and capture with live status badges.
 */

import type {
	Address,
	PaymentSession,
	PaymentSetting,
	PaymentSettingAdyen,
	PaymentSettingStripe,
	PaymentWallet,
} from "@commercelayer/sdk";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdyenPayment } from "@/gateways/adyen/adyen-payment";
import type { AdyenPendingAction } from "@/gateways/adyen/authorization";
import {
	ADYEN_RETURN_PARAMS,
	adyenReturn,
	resumeAdyenRedirect,
} from "@/gateways/adyen/redirect-return";
import { AdyenSavedCardPayment } from "@/gateways/adyen/saved-card-payment";
import { AdyenThreeDSAction } from "@/gateways/adyen/three-ds-action";
import { BraintreePayment } from "@/gateways/braintree/braintree-payment";
import { ManualPayment } from "@/gateways/manual/manual-payment";
import { MolliePayment } from "@/gateways/mollie/mollie-payment";
import {
	isMollieReturn,
	MOLLIE_RETURN_PARAMS,
	resumeMollieRedirect,
} from "@/gateways/mollie/redirect-return";
import { payWithStripeWallet } from "@/gateways/stripe/pay-with-wallet";
import {
	resumeStripeRedirect,
	STRIPE_RETURN_PARAMS,
	stripeReturnClientSecret,
} from "@/gateways/stripe/redirect-return";
import { StripePayment } from "@/gateways/stripe/stripe-payment";
import type { GatewayPaymentProps } from "@/gateways/types";
import { createClient } from "@/lib/create-client";
import { formatAmount } from "@/lib/format";
import { derivePaymentState } from "@/lib/payment-state";
import {
	authorizeAppliedGiftCards,
	cascadeDeleteSession,
	pollAndPlace,
	refundCapturedGiftCards,
	refundGiftCardSession,
} from "@/lib/payments";
import { customerIdFromToken } from "@/lib/token";
import { AuthorizedPaymentsList } from "./payment/authorized-payments-list";
import { GiftCardSection } from "./payment/gift-card-section";
import { PaymentMethodPicker } from "./payment/payment-method-picker";
import { PlacedPaymentAudit } from "./payment/placed-payment-audit";
import { RedirectPendingView } from "./payment/redirect-pending-view";
import { SavedCardsSection } from "./payment/saved-cards-section";

type Props = {
	orderId: string;
	/** "pending" | "placed" | "approved" | "cancelled" etc. */
	orderStatus: string;
	orderTotalAmountCents: number;
	orderCurrencyCode: string;
	/** Passed to Braintree 3-D Secure so the issuer can skip the challenge more often. */
	customerEmail?: string | null;
	billingAddress?: Address | null;
	/** Sales-channel access token (may carry a customer sub-token when logged in). */
	accessToken: string;
	/** All payment settings configured on this order's market. */
	availablePaymentSettings: PaymentSetting[];
	/** Current payment_sessions for this order (refreshed by the parent after each mutation). */
	paymentSessions: PaymentSession[];
	/** Whether the order carries a frequency and must mint its order_subscriptions
	 * once placed. */
	createSubscriptions: boolean;
	/** Whether every shipment has a shipping method. False hides the payment step
	 * altogether: the order cannot be placed, and its total is not final either,
	 * so any session created now would be sized against the wrong amount. */
	shippingReady: boolean;
	/** Called after the order transitions to "placed". */
	onOrderPlaced: () => void;
	/** Called after a gift card is applied/removed so the parent can refresh. */
	onGiftCardApplied: () => void;
};

const PLACED_STATUSES = ["placed", "approved", "cancelled"];

/** Order states in which the checkout still owns the payment, so a gift card can
 * be taken back off the order. Once the order has been placed — including when
 * it is reopened as `editing` — its sessions belong to the order and are no
 * longer the customer's to withdraw here. The API agrees: a storefront token
 * stops being able to read the captures behind those sessions, so the refund
 * that backs Remove could not be issued anyway. */
const CHECKOUT_STATUSES = ["draft", "pending"];

/**
 * The gateway module that takes over once the shopper picks one of its
 * payment settings. Each module holds that gateway's whole integration, from
 * creating the payment_session to its authorization.
 */
function GatewayPayment(props: GatewayPaymentProps) {
	switch (props.setting.type) {
		case "payment_setting_stripes":
			return <StripePayment {...props} />;
		case "payment_setting_adyens":
			return <AdyenPayment {...props} />;
		case "payment_setting_braintrees":
			return <BraintreePayment {...props} />;
		case "payment_setting_externals":
			return <MolliePayment {...props} />;
		case "payment_setting_manuals":
			return <ManualPayment {...props} />;
		default:
			return (
				<p className="mt-2 text-xs text-gray-400">
					This playground has no integration for {props.setting.type}.
				</p>
			);
	}
}

export function PaymentSection({
	orderId,
	orderStatus,
	orderTotalAmountCents,
	orderCurrencyCode,
	customerEmail,
	billingAddress,
	accessToken,
	availablePaymentSettings,
	paymentSessions,
	createSubscriptions,
	shippingReady,
	onOrderPlaced,
	onGiftCardApplied,
}: Props) {
	// ── Redirect-return detection ───────────────────────────────────────────
	// Each gateway that sends the shopper off-site recognizes its own return
	// from the query string.
	const searchParams = useSearchParams();
	const stripeReturnSecret = stripeReturnClientSecret(searchParams);
	const isStripeRedirectReturn = stripeReturnSecret != null;
	const adyenReturnParams = adyenReturn(searchParams);
	const isAdyenRedirectReturn = adyenReturnParams != null;
	const isMollieRedirectReturn = isMollieReturn(searchParams);

	const client = useMemo(() => createClient(accessToken), [accessToken]);

	// CL customer ID derived from the JWT — null when guest
	const customerId = useMemo(
		() => customerIdFromToken(accessToken),
		[accessToken],
	);

	const {
		giftCardSetting,
		paymentMethodSettings,
		appliedGiftCards,
		activeGiftCardSessions,
		authorizedMethodSessions,
		openMethodSessions,
		restoredMethodSession,
		coveredPaymentAmountCents,
		remainingPaymentAmountCents,
		nextGiftCardAmountCents,
		canApplyGiftCard,
	} = derivePaymentState(
		paymentSessions,
		availablePaymentSettings,
		orderTotalAmountCents,
	);

	// ── Gift card state ──────────────────────────────────────────────────────
	const [giftCardInput, setGiftCardInput] = useState("");
	const [applying, setApplying] = useState(false);
	const [applyError, setApplyError] = useState<string | null>(null);
	const [removingId, setRemovingId] = useState<string | null>(null);
	// True while the sessions are being rebuilt after the order was re-priced.
	const [resyncing, setResyncing] = useState(false);
	// Codes that could not be re-applied during that rebuild, shown so the
	// customer knows which cards fell off instead of finding out at placement.
	const [droppedGiftCards, setDroppedGiftCards] = useState<string[]>([]);

	// ── Payment method selection + amount ────────────────────────────────────
	const [selectedSettingId, setSelectedSettingId] = useState(
		() => restoredMethodSession?.payment_setting?.id ?? "",
	);
	const [amountInput, setAmountInput] = useState(() =>
		restoredMethodSession?.amount_cents != null
			? (restoredMethodSession.amount_cents / 100).toFixed(2)
			: "",
	);
	// On a recurring order storing the card is not a preference: the subscription
	// has nothing to charge without it, and an unsaved one lands in the broken
	// state where it is created but can never run. The shopper keeps the choice
	// only on a one-off order.
	const mustSaveCard = createSubscriptions;
	// A gateway has mounted a card form with no payment_session yet, so the
	// amount it was built for must not change.
	const [methodFormOpen, setMethodFormOpen] = useState(false);

	const selectedSetting = paymentMethodSettings.find(
		(s) => s.id === selectedSettingId,
	);

	// ── Payment session ──────────────────────────────────────────────────────
	// pendingSession: created by Confirm, waiting for the gateway's card form
	// (or restored from a previous unpaid/failed session on load)
	const [pendingSession, setPendingSession] = useState<PaymentSession | null>(
		() => {
			const t = restoredMethodSession?.payment_setting?.type;
			return t === "payment_setting_stripes" ||
				t === "payment_setting_adyens" ||
				t === "payment_setting_braintrees"
				? restoredMethodSession
				: null;
		},
	);

	// ── Place order ──────────────────────────────────────────────────────────
	const [placing, setPlacing] = useState(false);
	const [placeError, setPlaceError] = useState<string | null>(null);

	// ── Saved wallets (scenario 7) ───────────────────────────────────────────
	const [paymentWallets, setPaymentWallets] = useState<PaymentWallet[]>([]);
	const [payingWithWalletId, setPayingWithWalletId] = useState<string | null>(
		null,
	);
	const [deletingWalletId, setDeletingWalletId] = useState<string | null>(null);
	const [walletError, setWalletError] = useState<string | null>(null);
	// A saved Adyen card waiting for its CVC to be re-entered.
	const [adyenSavedCard, setAdyenSavedCard] = useState<{
		wallet: PaymentWallet;
		setting: PaymentSettingAdyen & { public_key?: string | null };
	} | null>(null);
	// A 3-D Secure step Adyen asked for, while paying with a saved card or after
	// a 3-D Secure redirect.
	const [adyenAction, setAdyenAction] = useState<AdyenPendingAction | null>(
		null,
	);

	// Ensures the Stripe and Mollie redirect-return effects run exactly once per mount
	const redirectHandledRef = useRef(false);
	// Same, for the Adyen 3DS redirect-return effect. `redirectResult` is
	// single-use: Adyen rejects a second submission of the same value.
	const adyenRedirectHandledRef = useRef(false);
	// Armed by confirm/authorize handlers; triggers auto-place when balance hits 0
	const autoPlaceRef = useRef(false);
	// Last order total the sessions were built for, so a re-price can be told
	// apart from any other re-render, plus an in-flight flag for the rebuild.
	const lastTotalRef = useRef(orderTotalAmountCents);
	const resyncingRef = useRef(false);
	const authorizeGiftCards = () =>
		authorizeAppliedGiftCards(client, appliedGiftCards);

	/**
	 * The tail every redirect return shares, once the gateway has authorized
	 * its session: place the order, drop the gateway's parameters from the URL
	 * so a reload doesn't resume twice, and refund any gift card already debited
	 * if anything fails. `resume` reports "awaiting-action" when the gateway
	 * still has a step to show (an Adyen 3-D Secure challenge): the order is
	 * placed once that step completes.
	 */
	async function completeRedirectReturn(
		resume: () => Promise<"authorized" | "awaiting-action">,
		returnParams: string[],
	) {
		setPlacing(true);
		setPlaceError(null);
		try {
			// A reload with the params still in the URL, or a webhook that
			// already settled the order: nothing left to submit.
			if (PLACED_STATUSES.includes(orderStatus)) {
				onOrderPlaced();
				return;
			}
			if ((await resume()) === "awaiting-action") return;
			await pollAndPlace(client, orderId, { createSubscriptions });
			onOrderPlaced();
		} catch (e) {
			await refundCapturedGiftCards(client, orderId);
			onGiftCardApplied(); // refresh so refunded gift cards disappear from UI
			setPlaceError(
				e instanceof Error
					? e.message
					: "Something went wrong completing your payment.",
			);
		} finally {
			const url = new URL(window.location.href);
			for (const param of returnParams) url.searchParams.delete(param);
			window.history.replaceState({}, "", url.toString());
			setPlacing(false);
		}
	}

	// ── Saved cards: fetch succeeded wallets on mount ────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: run once when customer is known
	useEffect(() => {
		if (!customerId) return;
		client.payment_wallets
			// include customer so wallet.customer.shopper_reference is available for
			// the Adyen reuse payload (CL-managed shopperReference).
			//
			// sort + pageSize matter: the API defaults to 10 per page ordered by `id`
			// ASC, so page 1 is the *oldest* wallets and anything newly saved lands on
			// page 2 — invisible here. Filtering the status server-side too, otherwise
			// non-succeeded wallets eat slots on an already short page.
			.list({
				include: ["payment_setting", "customer"],
				filters: { status_eq: "succeeded" },
				sort: { created_at: "desc" },
				pageSize: 25,
			})
			.then((wallets) => {
				setPaymentWallets(wallets ?? []);
			})
			.catch(() => {});
	}, [customerId]);

	// ── Stripe redirect-return recovery (Amazon Pay) ─────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount when redirect params are present
	useEffect(() => {
		if (!stripeReturnSecret || redirectHandledRef.current) return;
		redirectHandledRef.current = true;
		completeRedirectReturn(async () => {
			await resumeStripeRedirect({
				client,
				paymentSessions,
				clientSecret: stripeReturnSecret,
				authorizeGiftCards,
			});
			return "authorized";
		}, STRIPE_RETURN_PARAMS);
	}, [isStripeRedirectReturn]);

	// ── Mollie redirect-return recovery ──────────────────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount when redirect params are present
	useEffect(() => {
		if (!isMollieRedirectReturn || redirectHandledRef.current) return;
		redirectHandledRef.current = true;
		completeRedirectReturn(async () => {
			await resumeMollieRedirect({
				client,
				paymentSessions,
				authorizeGiftCards,
			});
			return "authorized";
		}, MOLLIE_RETURN_PARAMS);
	}, [isMollieRedirectReturn]);

	// ── Adyen 3DS redirect-return recovery ───────────────────────────────────
	// `redirectResult` is single-use: Adyen rejects a second submission of the
	// same value, hence its own once-per-mount guard.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount when the redirect param is present
	useEffect(() => {
		if (!adyenReturnParams || adyenRedirectHandledRef.current) return;
		adyenRedirectHandledRef.current = true;
		completeRedirectReturn(async () => {
			const pending = await resumeAdyenRedirect({
				client,
				paymentSessions,
				...adyenReturnParams,
				authorizeGiftCards,
			});
			if (pending) {
				setAdyenAction(pending);
				return "awaiting-action";
			}
			return "authorized";
		}, ADYEN_RETURN_PARAMS);
	}, [isAdyenRedirectReturn]);

	// ── Auto-place: fires when remaining balance hits zero ───────────────────
	// autoPlaceRef is armed by the confirm/authorize handlers.  Using a ref
	// (rather than state) prevents a re-render race where the effect could fire
	// before the parent refresh has returned the updated sessions.
	// biome-ignore lint/correctness/useExhaustiveDependencies: handlePlaceOrder is stable within a render cycle
	useEffect(() => {
		if (
			autoPlaceRef.current &&
			remainingPaymentAmountCents === 0 &&
			pendingSession == null &&
			!placing &&
			shippingReady &&
			!isStripeRedirectReturn &&
			!isMollieRedirectReturn &&
			!isAdyenRedirectReturn
		) {
			autoPlaceRef.current = false;
			handlePlaceOrder();
		}
	}, [remainingPaymentAmountCents, pendingSession, placing, shippingReady]);

	// ── Re-price: rebuild the sessions when the order total moves ────────────
	// Changing the shipping method or a line item quantity re-prices the order,
	// leaving every session sized for a total that no longer exists. `resyncing`
	// is a dependency so that a change arriving mid-rebuild is picked up on the
	// next render instead of being dropped.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on a total change, not on every dependency of the rebuild
	useEffect(() => {
		if (lastTotalRef.current === orderTotalAmountCents) return;
		if (resyncingRef.current) return;
		const previousTotal = lastTotalRef.current;
		lastTotalRef.current = orderTotalAmountCents;
		// A first total of 0 means the order hadn't priced yet, and a placed
		// order's sessions are settled — neither is a re-price.
		if (previousTotal === 0 || PLACED_STATUSES.includes(orderStatus)) return;
		resyncSessionsForNewTotal(orderTotalAmountCents);
	}, [orderTotalAmountCents, resyncing]);

	// ── Saved cards: pay with a stored payment_wallet ───────────────────────
	// Dispatches to the gateway-specific reuse path based on the wallet's setting.
	function handlePayWithWallet(wallet: PaymentWallet) {
		const setting = availablePaymentSettings.find(
			(s) => s.id === wallet.payment_setting?.id,
		);
		if (setting?.type === "payment_setting_adyens") {
			return handlePayWithWalletAdyen(
				wallet,
				setting as PaymentSettingAdyen & { public_key?: string | null },
			);
		}
		return handlePayWithWalletStripe(
			wallet,
			setting as PaymentSettingStripe | undefined,
		);
	}

	// Remove a saved card: deletes the CL payment_wallet record. (The gateway-side
	// stored method, e.g. on Adyen, must be removed separately.)
	async function handleDeleteWallet(wallet: PaymentWallet) {
		setDeletingWalletId(wallet.id);
		setWalletError(null);
		try {
			await client.payment_wallets.delete(wallet.id);
			setPaymentWallets((prev) => prev.filter((w) => w.id !== wallet.id));
		} catch (e) {
			setWalletError(e instanceof Error ? e.message : "Could not remove card.");
		} finally {
			setDeletingWalletId(null);
		}
	}

	async function handlePayWithWalletStripe(
		wallet: PaymentWallet,
		paymentSetting: PaymentSettingStripe | undefined,
	) {
		if (!paymentSetting) return;
		setPayingWithWalletId(wallet.id);
		setWalletError(null);
		try {
			await payWithStripeWallet({
				client,
				orderId,
				wallet,
				setting: paymentSetting,
				amountCents: remainingPaymentAmountCents,
				authorizeGiftCards,
			});
			autoPlaceRef.current = true;
			onGiftCardApplied(); // silent order refresh
		} catch (e) {
			setWalletError(e instanceof Error ? e.message : "Payment failed.");
		} finally {
			setPayingWithWalletId(null);
		}
	}

	/** Reuse a saved Adyen card: <AdyenSavedCardPayment> asks for the CVC
	 * first, then pays. */
	function handlePayWithWalletAdyen(
		wallet: PaymentWallet,
		paymentSetting: PaymentSettingAdyen & { public_key?: string | null },
	) {
		if (!paymentSetting.public_key || !wallet.payment_token) return;
		setWalletError(null);
		setPayingWithWalletId(wallet.id);
		setAdyenSavedCard({ wallet, setting: paymentSetting });
	}

	function endAdyenSavedCard(error?: string) {
		setAdyenSavedCard(null);
		setPayingWithWalletId(null);
		if (error) setWalletError(error);
	}

	/** A gateway authorized a session outside the add-payment form (a saved
	 * card, a 3-D Secure step): let the auto-place effect take it from here. */
	function handleWalletAuthorized() {
		autoPlaceRef.current = true;
		onGiftCardApplied(); // silent order refresh
	}

	// ── Render path B: placed / read-only audit view ─────────────────────────
	// Once the order is placed (or approved / cancelled) we switch to a
	// debug-friendly audit view that lists every session, authorization, and
	// capture with their status badges.  Capturing is done from the dashboard.
	if (PLACED_STATUSES.includes(orderStatus)) {
		return <PlacedPaymentAudit paymentSessions={paymentSessions} />;
	}

	// ── Handlers ─────────────────────────────────────────────────────────────

	// Resets the add-payment form and deletes any pending session.
	async function resetAddPaymentForm() {
		if (pendingSession != null) {
			const staleSessionId = pendingSession.id;
			setPendingSession(null);
			// Awaited: callers refresh the order right after, and a delete still
			// in flight would let the discarded session reappear in the list and
			// skew the covered/remaining counter.
			await client.payment_sessions.delete(staleSessionId).catch(() => {});
		}
		setSelectedSettingId("");
		setAmountInput("");
		setMethodFormOpen(false);
	}

	function handleMethodChange(settingId: string) {
		if (pendingSession != null) {
			client.payment_sessions.delete(pendingSession.id).catch(() => {});
			setPendingSession(null);
		}
		setMethodFormOpen(false);
		setSelectedSettingId(settingId);
		setAmountInput((remainingPaymentAmountCents / 100).toFixed(2));
		setPlaceError(null);
	}

	/** A gateway module got its session authorized: clear the add-payment form
	 * and let the auto-place effect place the order once nothing is left to
	 * pay. */
	function handleMethodAuthorized() {
		setPendingSession(null);
		setSelectedSettingId("");
		setAmountInput("");
		autoPlaceRef.current = true;
		onGiftCardApplied(); // silent order refresh
	}

	/**
	 * Discards method sessions left over from a previous attempt (unpaid, with
	 * no authorization or a failed one). Applying or removing a gift card moves
	 * the balance those sessions were sized for, and `amount_cents` can't be
	 * updated after creation, so the stale session has to go rather than be
	 * carried into placement. Sessions holding a live authorization are never
	 * in this set, so no money is ever discarded.
	 */
	async function discardStaleMethodSessions() {
		for (const session of openMethodSessions) {
			try {
				// Cascade: a failed authorization has to be deleted before its
				// session, which the API otherwise refuses.
				await cascadeDeleteSession(client, session.id);
			} catch {
				// Best-effort — a stale session holds no money and doesn't block
				// placement; surfacing this would only obscure the gift card result.
			}
		}
	}

	/**
	 * Rebuilds the order's sessions after a re-price.
	 *
	 * `amount_cents` is fixed when a session is created, so a session sized for
	 * the previous total can only be replaced, never corrected. Gift cards are
	 * torn down and re-applied in their original order, which lets the normal
	 * sizing rules pick the amounts again: the first card takes whatever it is
	 * worth, each later one the balance still due. A stale method session goes
	 * the same way, since it was sized for the old total too.
	 *
	 * Only sessions holding no money are touched. An authorized partial payment
	 * keeps its amount and the rebuilt gift cards are sized around it.
	 */
	async function resyncSessionsForNewTotal(totalAmountCents: number) {
		// Sorted by creation: the API promises no order for an order's sessions,
		// and the order decides which card absorbs the balance and which one is
		// left with nothing to cover and dropped.
		const rebuildable = appliedGiftCards
			.filter(
				(s) =>
					s.status === "unpaid" &&
					s.payment_authorization == null &&
					s.gift_card_code != null,
			)
			.sort((a, b) => a.created_at.localeCompare(b.created_at));
		if (rebuildable.length === 0 && openMethodSessions.length === 0) return;

		resyncingRef.current = true;
		setResyncing(true);
		setDroppedGiftCards([]);
		const settingId = giftCardSetting?.id;
		const codes = rebuildable.map((s) => s.gift_card_code as string);
		const rebuildableIds = new Set(rebuildable.map((s) => s.id));
		const failed: string[] = [];

		try {
			// The add-payment form was filled from the old balance, and any
			// leftover method session was sized against it.
			await resetAddPaymentForm();
			await discardStaleMethodSessions();
			for (const session of rebuildable) {
				try {
					await cascadeDeleteSession(client, session.id);
				} catch {
					// Best-effort: a session that resists deletion is re-read on the
					// refresh below, so it can't silently vanish from the totals.
				}
			}

			// Coverage is tracked locally: `paymentSessions` only refreshes once,
			// at the end, so the derived state can't be consulted mid-rebuild.
			let coveredCents =
				authorizedMethodSessions.reduce(
					(total, s) => total + (s.amount_cents ?? 0),
					0,
				) +
				activeGiftCardSessions
					.filter((s) => !rebuildableIds.has(s.id))
					.reduce((total, s) => total + (s.amount_cents ?? 0), 0);

			for (const code of codes) {
				const remainingCents = totalAmountCents - coveredCents;
				// A card with nothing left to cover is dropped without comment: the
				// order simply got cheaper than the cards already on it.
				if (remainingCents <= 0) continue;
				if (!settingId) {
					failed.push(code);
					continue;
				}
				try {
					const session = await client.payment_sessions.create({
						gift_card_code: code,
						...(coveredCents === 0 ? {} : { amount_cents: remainingCents }),
						payment_setting: client.payment_settings.relationship(settingId),
						order: client.orders.relationship(orderId),
					});
					const appliedCents = session.amount_cents ?? 0;
					// Worth nothing now — the card was spent between the two totals.
					// That is a card the customer loses, not one that no longer fits.
					if (appliedCents <= 0) {
						await client.payment_sessions.delete(session.id).catch(() => {});
						failed.push(code);
						continue;
					}
					coveredCents += appliedCents;
				} catch {
					failed.push(code);
				}
			}
		} finally {
			setDroppedGiftCards(failed);
			resyncingRef.current = false;
			setResyncing(false);
			onGiftCardApplied();
		}
	}

	/**
	 * Applies a gift card as a payment_session against the order.
	 *
	 * The amount is left to the API only for the first gift card on an
	 * otherwise-uncovered order; from there on it is sent explicitly, because
	 * the API sizes an amount-less session to the order total still to be
	 * *authorized* and gift cards are only authorized at place-order time — an
	 * already-applied gift card is invisible to that calculation.
	 *
	 * The created session comes back sized to the card's real balance, which can
	 * be lower than what was asked for. That is why the remaining balance is
	 * re-read from the refreshed order instead of being assumed covered: a card
	 * worth 60 against a 100 balance leaves 40 still to pay, and the entry stays
	 * open for another card or another payment method.
	 */
	async function handleApplyGiftCard() {
		const code = giftCardInput.trim();
		if (!code || !giftCardSetting || !canApplyGiftCard) return;

		// A second session against a card the order already holds would claim a
		// balance the first session has spoken for, so it's caught before the call.
		if (
			activeGiftCardSessions.some(
				(s) => s.gift_card_code?.toLowerCase() === code.toLowerCase(),
			)
		) {
			setApplyError("This gift card is already applied to the order.");
			return;
		}

		setApplying(true);
		setApplyError(null);
		setDroppedGiftCards([]);
		try {
			const session = await client.payment_sessions.create({
				gift_card_code: code,
				...(nextGiftCardAmountCents != null
					? { amount_cents: nextGiftCardAmountCents }
					: {}),
				payment_setting: client.payment_settings.relationship(
					giftCardSetting.id,
				),
				order: client.orders.relationship(orderId),
			});

			// A spent card yields a session worth nothing: it covers no part of the
			// order and would only sit in the list as a dead row, so it's dropped.
			if ((session.amount_cents ?? 0) <= 0) {
				await client.payment_sessions.delete(session.id).catch(() => {});
				setApplyError("This gift card has no balance left.");
				return;
			}

			setGiftCardInput("");
			await resetAddPaymentForm();
			await discardStaleMethodSessions();
			onGiftCardApplied();
		} catch (e) {
			setApplyError(
				e instanceof Error ? e.message : "Failed to apply gift card.",
			);
		} finally {
			setApplying(false);
		}
	}

	/**
	 * Removes a gift card from the order.
	 *
	 * A session that never reached an authorization holds nothing, so it is
	 * simply deleted. One that carries an authorization has already been
	 * debited, and deleting it would throw the record away while leaving the
	 * balance spent — it is refunded instead, which hands the balance back and
	 * drops the session out of the list on the next refresh.
	 *
	 * That second case is reachable without any failure of ours: gift cards are
	 * authorized just before placement, so a page closed, reloaded, or
	 * disconnected in that window leaves a debited card on an order that was
	 * never placed, with the rollback never reached. Remove is what the customer
	 * has to undo it.
	 */
	async function handleRemoveGiftCard(sessionId: string) {
		if (!canRemoveGiftCard) return;
		setRemovingId(sessionId);
		setDroppedGiftCards([]);
		setApplyError(null);
		try {
			const session = appliedGiftCards.find((s) => s.id === sessionId);
			if (session?.payment_authorization != null) {
				await refundGiftCardSession(client, sessionId);
			} else {
				await cascadeDeleteSession(client, sessionId);
			}
			await resetAddPaymentForm();
			await discardStaleMethodSessions();
			onGiftCardApplied();
		} catch (e) {
			setApplyError(
				e instanceof Error ? e.message : "Failed to remove the gift card.",
			);
		} finally {
			setRemovingId(null);
		}
	}

	/**
	 * handlePlaceOrder — final placement step.
	 *
	 * Gift card sessions are normally authorized just before the chosen
	 * payment method's authorization (see authorizeAppliedGiftCards). This is
	 * a safety net for the case where gift cards alone cover the full order
	 * amount and no method session was ever confirmed.
	 *
	 * On failure, any gift cards that were already captured are refunded.
	 */
	async function handlePlaceOrder() {
		setPlacing(true);
		setPlaceError(null);
		try {
			// Authorize any applied gift card sessions not authorized yet
			// (e.g. when gift cards alone cover the full order amount)
			await authorizeAppliedGiftCards(client, appliedGiftCards);
			// A frequency on the line items does not create anything by itself —
			// placement has to carry `_create_subscriptions` for CL to mint the
			// order_subscriptions, which it does in the same patch as `_place`.
			await pollAndPlace(client, orderId, { createSubscriptions });
			onOrderPlaced();
		} catch (e) {
			await refundCapturedGiftCards(client, orderId);
			onGiftCardApplied(); // refresh so refunded gift cards disappear from UI
			setPlaceError(e instanceof Error ? e.message : "Something went wrong.");
		} finally {
			setPlacing(false);
		}
	}

	const canRemoveGiftCard = CHECKOUT_STATUSES.includes(orderStatus);
	const amountCents = Math.round(parseFloat(amountInput) * 100);
	const isAmountValid =
		!Number.isNaN(amountCents) &&
		amountCents >= 1 &&
		amountCents <= remainingPaymentAmountCents;
	const canPlace =
		!placing &&
		shippingReady &&
		!isStripeRedirectReturn &&
		!isMollieRedirectReturn &&
		!isAdyenRedirectReturn &&
		remainingPaymentAmountCents === 0 &&
		pendingSession == null;

	// ── Render ────────────────────────────────────────────────────────────────

	// ── Render path A: redirect in progress ──────────────────────────────────
	// The customer has returned from Amazon Pay (or similar), from Mollie, or
	// from an Adyen 3DS redirect. Show a spinner while the recovery effect
	// submits the result and places the order — not the checkout form, which
	// would invite a double payment. A follow-up 3DS action, if any, still
	// renders below.
	if (
		isStripeRedirectReturn ||
		isMollieRedirectReturn ||
		(isAdyenRedirectReturn && adyenAction == null)
	) {
		return <RedirectPendingView placeError={placeError} />;
	}

	// ── Render path E: shipping not chosen yet ───────────────────────────────
	// Deliberately after the redirect paths, so a customer coming back from a
	// gateway still reaches the recovery effect above. Any line item write —
	// changing a quantity, or picking a subscription frequency — rebuilds the
	// shipments and drops the method already chosen, which also drops the
	// shipping cost from the total. Collecting payment here would charge the
	// pre-shipping amount and then fail placement, so the whole step waits.
	if (!shippingReady) {
		return (
			<section className="rounded-2xl border border-gray-200 bg-white">
				<div className="border-b border-gray-100 px-6 py-4">
					<h2 className="font-semibold">Payment</h2>
				</div>
				<p className="px-6 py-5 text-sm text-gray-500">
					Choose a shipping method above to continue to payment.
				</p>
			</section>
		);
	}

	return (
		// ── Render path C: active checkout ───────────────────────────────────────
		// The main payment form: shows authorized partial payments, gift card
		// section, the add-payment form (method selector + amount + the chosen
		// gateway's module), and the Place Order button when the balance hits
		// zero.
		<section className="rounded-2xl border border-gray-200 bg-white">
			<div className="border-b border-gray-100 px-6 py-4">
				<h2 className="font-semibold">Payment</h2>
			</div>

			<div className="divide-y divide-gray-100">
				{/* Authorized method sessions — locked in, shown for debug */}
				{authorizedMethodSessions.length > 0 && (
					<AuthorizedPaymentsList sessions={authorizedMethodSessions} />
				)}

				{/* Gift cards */}
				{giftCardSetting && (
					<GiftCardSection
						appliedGiftCards={appliedGiftCards}
						giftCardInput={giftCardInput}
						onGiftCardInputChange={setGiftCardInput}
						applying={applying || resyncing}
						applyError={applyError}
						droppedGiftCards={droppedGiftCards}
						removingId={removingId}
						canRemove={canRemoveGiftCard}
						canApply={canApplyGiftCard}
						coveredAmountCents={coveredPaymentAmountCents}
						remainingAmountCents={remainingPaymentAmountCents}
						orderTotalAmountCents={orderTotalAmountCents}
						currencyCode={orderCurrencyCode}
						onApply={handleApplyGiftCard}
						onRemove={handleRemoveGiftCard}
					/>
				)}

				{/* Saved cards — shown for logged-in customers with succeeded wallets */}
				{paymentWallets.length > 0 && remainingPaymentAmountCents > 0 && (
					<SavedCardsSection
						paymentWallets={paymentWallets}
						availablePaymentSettings={availablePaymentSettings}
						payingWithWalletId={payingWithWalletId}
						deletingWalletId={deletingWalletId}
						walletError={walletError}
						onPay={handlePayWithWallet}
						onDelete={handleDeleteWallet}
					/>
				)}

				{/* CVC re-entry for a saved Adyen card (merchant keeps CVC required) */}
				{adyenSavedCard && (
					<AdyenSavedCardPayment
						client={client}
						orderId={orderId}
						wallet={adyenSavedCard.wallet}
						setting={adyenSavedCard.setting}
						amountCents={remainingPaymentAmountCents}
						currencyCode={orderCurrencyCode}
						authorizeGiftCards={authorizeGiftCards}
						onAuthorized={() => {
							endAdyenSavedCard();
							handleWalletAuthorized();
						}}
						onActionRequired={(pending) => {
							endAdyenSavedCard();
							setAdyenAction(pending);
						}}
						onError={endAdyenSavedCard}
						onCancel={() => endAdyenSavedCard()}
					/>
				)}

				{/* 3-D Secure step Adyen asked for (saved card, or after a redirect) */}
				{adyenAction && (
					<AdyenThreeDSAction
						client={client}
						orderId={orderId}
						pending={adyenAction}
						onAuthorized={() => {
							setAdyenAction(null);
							handleWalletAuthorized();
						}}
						onError={(m) => {
							setAdyenAction(null);
							setWalletError(m);
						}}
					/>
				)}

				{/* Add payment — shown while there is remaining balance */}
				{remainingPaymentAmountCents > 0 && (
					<div className="px-6 py-5">
						<p className="mb-1 text-sm font-medium text-gray-700">
							Add payment
						</p>
						<p className="mb-3 text-xs text-gray-400">
							Remaining:{" "}
							{formatAmount(remainingPaymentAmountCents, orderCurrencyCode)}
						</p>

						<PaymentMethodPicker
							paymentMethodSettings={paymentMethodSettings}
							selectedSettingId={selectedSettingId}
							onMethodChange={handleMethodChange}
							amountInput={amountInput}
							onAmountChange={setAmountInput}
							orderCurrencyCode={orderCurrencyCode}
							remainingPaymentAmountCents={remainingPaymentAmountCents}
							hasPendingSession={pendingSession != null || methodFormOpen}
						/>

						{selectedSetting && (
							<GatewayPayment
								key={selectedSetting.id}
								client={client}
								orderId={orderId}
								setting={selectedSetting}
								amountCents={isAmountValid ? amountCents : null}
								currencyCode={orderCurrencyCode}
								customerEmail={customerEmail}
								billingAddress={billingAddress}
								customerId={customerId}
								mustSaveCard={mustSaveCard}
								session={pendingSession}
								onSessionChange={setPendingSession}
								onFormOpenChange={setMethodFormOpen}
								authorizeGiftCards={authorizeGiftCards}
								onAuthorized={handleMethodAuthorized}
								onCancel={resetAddPaymentForm}
							/>
						)}
					</div>
				)}
			</div>

			{placeError && (
				<div className="mx-6 mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
					{placeError}
				</div>
			)}

			{/* Place Order — only when remaining balance is zero */}
			{remainingPaymentAmountCents === 0 && (
				<div className="px-6 pb-6">
					<button
						type="button"
						disabled={!canPlace}
						onClick={handlePlaceOrder}
						className="w-full cursor-pointer rounded-xl bg-gray-900 py-4 text-base font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{placing ? "Placing order…" : "Place Order"}
					</button>
				</div>
			)}
		</section>
	);
}
