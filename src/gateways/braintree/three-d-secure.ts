import type { Address } from "@commercelayer/sdk";
import type { ThreeDSecureBillingAddress } from "braintree-web/three-d-secure";

/** Map the order's billing address onto the shape 3-D Secure expects. Sending it
 * (and the email) lets the issuer decide frictionlessly more often, so fewer
 * shoppers see a challenge. */
export function toThreeDSecureAddress(
	address: Address | null | undefined,
): ThreeDSecureBillingAddress | undefined {
	if (!address) return undefined;
	return {
		givenName: address.first_name ?? undefined,
		surname: address.last_name ?? undefined,
		phoneNumber: address.phone ?? undefined,
		streetAddress: address.line_1,
		extendedAddress: address.line_2 ?? undefined,
		locality: address.city,
		region: address.state_code ?? undefined,
		postalCode: address.zip_code ?? undefined,
		countryCodeAlpha2: address.country_code,
	};
}

/** The amount as 3-D Secure wants it: a decimal string in the major unit. */
export function threeDSecureAmount(amountCents: number): string {
	return (amountCents / 100).toFixed(2);
}

/**
 * Refuse a payment whose 3-D Secure authentication was possible but did not
 * shift liability, i.e. a failed or abandoned challenge. CL authorizes with the
 * nonce alone and runs no 3DS check of its own, so the browser is the only
 * place this outcome can be enforced.
 */
export function assertLiabilityShift(
	info:
		| { liabilityShiftPossible?: boolean; liabilityShifted?: boolean }
		| undefined,
): void {
	if (info?.liabilityShiftPossible && !info.liabilityShifted) {
		throw new Error(
			"Card authentication was not completed. Try again or use another card.",
		);
	}
}
