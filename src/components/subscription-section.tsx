"use client";

import type {
	Order,
	OrderSubscription,
	PaymentWallet,
} from "@commercelayer/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/create-client";
import { cardLabel } from "@/lib/payment-labels";
import {
	activateSubscription,
	attachWallet,
	cancelSubscription,
	createSubscriptions,
	deactivateSubscription,
	FREQUENCY_LABELS,
	fetchOrderSubscriptions,
	fetchWallets,
	orderFrequency,
	recurringLineItems,
	rescheduleSubscription,
	SUBSCRIPTION_FREQUENCIES,
	type SubscriptionFrequency,
	setOrderFrequency,
} from "@/lib/subscriptions";

const PLACED_STATUSES = ["placed", "approved", "cancelled"];

const SUBSCRIPTION_STATUS_STYLES: Record<string, string> = {
	draft: "bg-gray-100 text-gray-500",
	pending: "bg-yellow-100 text-yellow-700",
	inactive: "bg-gray-100 text-gray-500",
	active: "bg-green-100 text-green-700",
	running: "bg-blue-100 text-blue-700",
	cancelled: "bg-red-100 text-red-600",
};

/** An ISO instant as the local `datetime-local` input wants it (no timezone,
 * minute precision). */
function toLocalInputValue(value: string | null | undefined): string {
	if (!value) return "";
	const d = new Date(value);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(value: string | null | undefined): string {
	if (!value) return "—";
	return new Date(value).toLocaleString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

type Props = {
	order: Order;
	accessToken: string;
	/** Whether the shopper is logged in. Subscriptions are offered to customers
	 * only; see the note on the component. */
	isCustomer: boolean;
	onFrequencyChanged: () => void;
};

/**
 * Subscription — turns the order into a recurring one.
 *
 * Before placement the shopper picks a frequency, which is written onto the
 * order's SKU line items. After placement the subscription CL generated from
 * them is shown here, together with the saved card its future runs will be
 * charged on.
 *
 * Offered to logged-in customers only, and this is a product decision rather
 * than an API limit: a guest order does produce a subscription, because CL
 * creates a customer from the order's `customer_email` when it is placed. What a
 * guest cannot do is the part that makes a recurring charge possible — saved
 * cards are listed per customer, so there is no wallet to bind, and no way back
 * to the subscription afterwards since a guest token cannot read the order. It
 * would create a subscription nobody can charge or cancel.
 *
 * The frequencies offered must be declared on the subscription_model of the
 * order's market; without one the API refuses the frequency outright.
 */
export function SubscriptionSection({
	order,
	accessToken,
	isCustomer,
	onFrequencyChanged,
}: Props) {
	const client = useMemo(() => createClient(accessToken), [accessToken]);

	const [saving, setSaving] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [subscriptions, setSubscriptions] = useState<OrderSubscription[]>([]);
	const [wallets, setWallets] = useState<PaymentWallet[]>([]);
	const [busySubId, setBusySubId] = useState<string | null>(null);

	const isPlaced = PLACED_STATUSES.includes(order.status ?? "");
	const currentFrequency = orderFrequency(order);
	const hasItems = recurringLineItems(order).length > 0;

	const refreshSubscriptions = useCallback(async () => {
		try {
			setSubscriptions(await fetchOrderSubscriptions(client, order.id));
		} catch {
			// The panel is informational; a failed refresh keeps the last view.
		}
	}, [client, order.id]);

	// After placement the subscription is created by the payment step, and the
	// wallet list is what lets the shopper bind a card to it. Skipped entirely
	// for a guest, who is not shown this section at all.
	useEffect(() => {
		if (!isPlaced || !isCustomer) return;
		refreshSubscriptions();
		fetchWallets(client)
			.then(setWallets)
			.catch(() => setWallets([]));
	}, [isPlaced, isCustomer, client, refreshSubscriptions]);

	async function handleSelect(frequency: SubscriptionFrequency | null) {
		setSaving(frequency ?? "none");
		setError(null);
		try {
			await setOrderFrequency(client, order, frequency);
			onFrequencyChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not set the frequency.");
		} finally {
			setSaving(null);
		}
	}

	async function handleCreate() {
		setSaving("create");
		setError(null);
		try {
			await createSubscriptions(client, order.id);
			await refreshSubscriptions();
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not create the subscription.",
			);
		} finally {
			setSaving(null);
		}
	}

	async function handleAttachWallet(subscriptionId: string, walletId: string) {
		setBusySubId(subscriptionId);
		setError(null);
		try {
			await attachWallet(client, subscriptionId, walletId);
			await refreshSubscriptions();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not attach the card.");
		} finally {
			setBusySubId(null);
		}
	}

	async function handleReschedule(subscriptionId: string, nextRunAt: string) {
		setBusySubId(subscriptionId);
		setError(null);
		try {
			await rescheduleSubscription(client, subscriptionId, nextRunAt);
			await refreshSubscriptions();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not reschedule.");
		} finally {
			setBusySubId(null);
		}
	}

	async function handleRunning(subscriptionId: string, running: boolean) {
		setBusySubId(subscriptionId);
		setError(null);
		try {
			await (running ? activateSubscription : deactivateSubscription)(
				client,
				subscriptionId,
			);
			await refreshSubscriptions();
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: running
						? "Could not start it."
						: "Could not pause it.",
			);
		} finally {
			setBusySubId(null);
		}
	}

	async function handleCancel(subscriptionId: string) {
		setBusySubId(subscriptionId);
		setError(null);
		try {
			await cancelSubscription(client, subscriptionId);
			await refreshSubscriptions();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not cancel.");
		} finally {
			setBusySubId(null);
		}
	}

	if (!hasItems || !isCustomer) return null;

	return (
		<section className="rounded-2xl border border-gray-200 bg-white">
			<div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
				<h2 className="font-semibold">Subscription</h2>
				{currentFrequency && (
					<span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700">
						{FREQUENCY_LABELS[currentFrequency as SubscriptionFrequency] ??
							currentFrequency}
					</span>
				)}
			</div>

			{/* Before placement: pick how often the order repeats. */}
			{!isPlaced && (
				<div className="px-6 py-5">
					<p className="mb-3 text-sm text-gray-500">
						Repeat this order automatically. The frequency is stored on the line
						items; the subscription itself is created once the order is placed.
						Changing it rebuilds the shipments, so the shipping method has to be
						picked again.
					</p>

					<div className="flex flex-wrap gap-2">
						<FrequencyButton
							label="One-off"
							selected={currentFrequency == null}
							busy={saving === "none"}
							disabled={saving != null}
							onClick={() => handleSelect(null)}
						/>
						{SUBSCRIPTION_FREQUENCIES.map((frequency) => (
							<FrequencyButton
								key={frequency}
								label={FREQUENCY_LABELS[frequency]}
								selected={currentFrequency === frequency}
								busy={saving === frequency}
								disabled={saving != null}
								onClick={() => handleSelect(frequency)}
							/>
						))}
					</div>
				</div>
			)}

			{/* After placement: what CL generated, and the card it will charge. */}
			{isPlaced && (
				<div className="px-6 py-5">
					{subscriptions.length === 0 ? (
						currentFrequency ? (
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-sm text-gray-500">
									No subscription was created for this order yet.
								</p>
								<button
									type="button"
									onClick={handleCreate}
									disabled={saving != null}
									className="cursor-pointer rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{saving === "create" ? "Creating…" : "Create subscription"}
								</button>
							</div>
						) : (
							<p className="text-sm text-gray-400">
								This order was placed as a one-off.
							</p>
						)
					) : (
						<ul className="flex flex-col gap-3">
							{subscriptions.map((sub) => (
								<SubscriptionRow
									key={sub.id}
									subscription={sub}
									wallets={wallets}
									busy={busySubId === sub.id}
									onAttachWallet={(walletId) =>
										handleAttachWallet(sub.id, walletId)
									}
									onReschedule={(nextRunAt) =>
										handleReschedule(sub.id, nextRunAt)
									}
									onSetRunning={(running) => handleRunning(sub.id, running)}
									onCancel={() => handleCancel(sub.id)}
								/>
							))}
						</ul>
					)}
				</div>
			)}

			{error && (
				<p className="border-t border-gray-100 px-6 py-3 text-sm text-red-500">
					{error}
				</p>
			)}
		</section>
	);
}

function FrequencyButton({
	label,
	selected,
	busy,
	disabled,
	onClick,
}: {
	label: string;
	selected: boolean;
	busy: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			// Reflects the frequency actually stored on the order, not the click:
			// it only flips once the write has landed and the order was refreshed.
			aria-pressed={selected}
			className={`cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
				selected
					? "border-gray-900 bg-gray-900 text-white"
					: "border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900"
			}`}
		>
			{busy ? "Saving…" : label}
		</button>
	);
}

function SubscriptionRow({
	subscription,
	wallets,
	busy,
	onAttachWallet,
	onReschedule,
	onSetRunning,
	onCancel,
}: {
	subscription: OrderSubscription;
	wallets: PaymentWallet[];
	busy: boolean;
	onAttachWallet: (walletId: string) => void;
	onReschedule: (nextRunAt: string) => void;
	onSetRunning: (running: boolean) => void;
	onCancel: () => void;
}) {
	const [nextRunInput, setNextRunInput] = useState(() =>
		toLocalInputValue(subscription.next_run_at),
	);
	const status = subscription.status ?? "draft";
	const statusStyle =
		SUBSCRIPTION_STATUS_STYLES[status] ?? "bg-gray-100 text-gray-500";
	const wallet = subscription.payment_wallet ?? null;
	const isCancelled = status === "cancelled";
	// `running` is a transient state CL sets while a run is in flight, so it
	// counts as going for the purposes of the pause control.
	const isRunning = status === "active" || status === "running";

	return (
		<li className="rounded-xl border border-gray-200 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium text-sm">
					#{subscription.number ?? subscription.id}
				</span>
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle}`}
				>
					{status}
				</span>
				<span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
					{FREQUENCY_LABELS[subscription.frequency as SubscriptionFrequency] ??
						subscription.frequency}
				</span>
				{!isCancelled && (
					<div className="ml-auto flex items-center gap-1">
						<button
							type="button"
							onClick={() => onSetRunning(!isRunning)}
							disabled={busy}
							className="cursor-pointer rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isRunning ? "Pause" : "Start"}
						</button>
						<button
							type="button"
							onClick={onCancel}
							disabled={busy}
							className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				)}
			</div>

			{!isCancelled && !isRunning && (
				<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
					Not running — it will not charge on its schedule until started. Right
					after a checkout that saved the card this is expected for a few
					seconds: the subscription is created before the card turns into a
					wallet, and CL starts it once the wallet arrives. Reload to see it.
				</p>
			)}

			<dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
				<div className="flex gap-1.5">
					<dt>Next run</dt>
					<dd className="text-gray-700">
						{formatDate(subscription.next_run_at)}
					</dd>
				</div>
				<div className="flex gap-1.5">
					<dt>Runs</dt>
					<dd className="text-gray-700">{subscription.occurrencies ?? 0}</dd>
				</div>
			</dl>

			{/* Move the next charge. Only the next one — the frequency still drives
			    the ones after it — and only forwards, which the API enforces. */}
			{!isCancelled && (
				<form
					className="mt-3 flex flex-wrap items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (nextRunInput)
							onReschedule(new Date(nextRunInput).toISOString());
					}}
				>
					<label
						className="text-xs text-gray-500"
						htmlFor={`next-run-${subscription.id}`}
					>
						Reschedule
					</label>
					<input
						id={`next-run-${subscription.id}`}
						type="datetime-local"
						value={nextRunInput}
						min={toLocalInputValue(new Date().toISOString())}
						onChange={(e) => setNextRunInput(e.target.value)}
						disabled={busy}
						className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-gray-400 disabled:opacity-50"
					/>
					<button
						type="submit"
						disabled={busy || !nextRunInput}
						className="cursor-pointer rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Set
					</button>
				</form>
			)}

			{/* The card each run is charged on. A gateway payment setting cannot be
			    set directly on the subscription — it has to come in as a wallet. */}
			<div className="mt-3 border-t border-gray-100 pt-3">
				{wallet ? (
					<p className="text-xs text-gray-500">
						Charged on{" "}
						<span className="font-medium text-gray-800">
							{cardLabel(wallet)}
						</span>
					</p>
				) : isCancelled ? null : wallets.length === 0 ? (
					<p className="text-xs text-gray-400">
						No saved card yet. A card saved during this checkout appears a few
						seconds after placement — reload, then bind it here.
					</p>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs text-gray-500">Charge on:</span>
						{wallets.map((w) => (
							<button
								key={w.id}
								type="button"
								onClick={() => onAttachWallet(w.id)}
								disabled={busy}
								className="cursor-pointer rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{cardLabel(w)}
							</button>
						))}
					</div>
				)}
			</div>
		</li>
	);
}
