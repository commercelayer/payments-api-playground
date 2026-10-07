"use client";

import type { CoreConfiguration } from "@adyen/adyen-web";

/**
 * Finish a Drop-in (sessions flow) payment after a 3-D Secure redirect.
 *
 * The redirect unmounts the Drop-in, and in the sessions flow adyen-web talks to
 * Adyen directly, so nothing on CL's side can complete the payment. Adyen
 * returns to the `returnUrl` with its own `sessionId` and a `redirectResult`,
 * and the documented way to resume is a new checkout instance on that session
 * that submits the result. No component has to be mounted for it.
 *
 * Resolves with Adyen's `resultCode`, or rejects with Adyen's error.
 */
export async function completeAdyenSessionRedirect({
	clientKey,
	sessionId,
	sessionData,
	redirectResult,
}: {
	clientKey: string;
	sessionId: string;
	sessionData: string;
	redirectResult: string;
}): Promise<string | undefined> {
	const { AdyenCheckout } = await import("@adyen/adyen-web");
	return new Promise((resolve, reject) => {
		const config: CoreConfiguration = {
			environment: clientKey.startsWith("live_") ? "live" : "test",
			clientKey,
			session: { id: sessionId, sessionData },
			onPaymentCompleted: (data) =>
				resolve("resultCode" in data ? data.resultCode : undefined),
			onPaymentFailed: (data) =>
				resolve(data && "resultCode" in data ? data.resultCode : "Refused"),
			onError: (error) => reject(error),
		};
		AdyenCheckout(config)
			.then((checkout) =>
				checkout.submitDetails({ details: { redirectResult } }),
			)
			.catch(reject);
	});
}
