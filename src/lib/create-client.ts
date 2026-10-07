import { CommerceLayer } from "@commercelayer/sdk";

/** Set `NEXT_PUBLIC_CL_DEBUG_REQUESTS=1` to log every CL API request with its exact
 * wire body. That's what you want when checking what a trigger attribute actually
 * sends — e.g. `_payment_details` must go out as
 * `{"data":{…,"attributes":{"_payment_details":{"details":{…},"paymentData":"…"}}}}`,
 * since CL forwards that value verbatim to Adyen /payments/details.
 *
 * Server actions log to the terminal, browser-side calls to the devtools console
 * (`NEXT_PUBLIC_` is readable from both). Debug only — the body includes payment
 * client_data; keep it off by default. */
const DEBUG_REQUESTS = process.env.NEXT_PUBLIC_CL_DEBUG_REQUESTS === "1";

export function createClient(accessToken: string) {
	const client = CommerceLayer({ accessToken, apiVersion: "2026-05" });
	if (DEBUG_REQUESTS) {
		client.addRequestInterceptor((request) => {
			const { method, body } = request.options;
			console.log(`[CL] ${method ?? "GET"} ${request.url}`, body ?? "");
			return request;
		});
	}
	return client;
}
