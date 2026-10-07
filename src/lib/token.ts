import { jwtDecode, jwtIsSalesChannel } from "@commercelayer/js-auth";

/**
 * The customer id carried by a sales-channel token, or null for a guest.
 *
 * The storefront always holds a sales-channel token; logging in swaps it for one
 * whose `owner` is the customer. Resources that belong to a customer rather than
 * to the order — saved cards, subscriptions — are only reachable with the
 * latter, so this is the check that decides whether to offer them at all.
 */
export function customerIdFromToken(accessToken: string): string | null {
	try {
		const { payload } = jwtDecode(accessToken);
		if (jwtIsSalesChannel(payload) && payload.owner?.type === "Customer") {
			return payload.owner.id;
		}
	} catch {
		/* a malformed token is simply not a customer token */
	}
	return null;
}
