/** An Adyen 3-D Secure step still to run: the action adyen-web renders, the
 * payment_session it belongs to, and the client key to render it with. */
export type AdyenPendingAction = {
	action: Record<string, unknown>;
	sessionId: string;
	clientKey: string;
};

/** A polled Adyen authorization counts as successful when CL marks it succeeded
 * or Adyen returns an accepting resultCode. Mirrors the express advanced flow. */
export function isAdyenAuthSuccess(auth: {
	status: string;
	response_data?: Record<string, unknown> | null;
}): boolean {
	if (auth.status === "succeeded") return true;
	const resultCode = auth.response_data?.resultCode;
	return (
		typeof resultCode === "string" &&
		["Authorised", "Received"].includes(resultCode)
	);
}

/** Adyen action to hand to adyen-web's `createFromAction`, or null when there
 * is none to render. CL can report `requires_action` with no usable action (e.g.
 * the relay to Adyen failed, or a `Pending` resultCode, which CL does not map to
 * a next_action_type), and `createFromAction` throws on an object without a
 * `type`. Validating here lets the caller surface a readable error instead of
 * crashing on mount.
 *
 * Prefer `next_action_data`: `response_data` is NOT served to sales-channel /
 * customer tokens, so in the browser it is always undefined and only the
 * next_action projection carries the action. `response_data.action` stays as a
 * fallback for integration-token reads and for authorizations created before CL
 * added the projection. Gate on `next_action_type` — `next_action_data` comes
 * back as `{}`, not null, when there is nothing to do. */
export function adyenAction(auth: {
	response_data?: Record<string, unknown> | null;
	next_action_type?: string | null;
	next_action_data?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
	const action = auth.next_action_type
		? auth.next_action_data
		: auth.response_data?.action;
	if (
		action != null &&
		typeof action === "object" &&
		typeof (action as { type?: unknown }).type === "string"
	) {
		return action as Record<string, unknown>;
	}
	return null;
}
