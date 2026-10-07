import {
	authenticate,
	jwtVerify,
	makeIntegration,
	makeSalesChannel,
	type Storage,
	type StorageValue,
} from "@commercelayer/js-auth";
import { cookies } from "next/headers";
import { createClient } from "./create-client";

function createMemoryStorage(): Storage {
	const store = new Map<string, StorageValue>();
	return {
		name: "memory",
		async getItem(key) {
			return store.get(key) ?? null;
		},
		async setItem(key, value) {
			store.set(key, value);
		},
		async removeItem(key) {
			store.delete(key);
		},
	};
}

// The customer token cookie key. This is the only value written to a cookie;
// the guest token is kept in memory (it's stateless and can be recreated on
// every cold start without side effects).
const CUSTOMER_COOKIE = "cl_customer_token";

// Reads the stored customer auth from the cookie. Safe to call anywhere
// (Server Components, Server Actions, Route Handlers). Returns null when the
// token is missing, unparseable, or no longer valid — `jwtVerify` rejects an
// expired signature as well as a tampered one — so callers transparently fall
// back to the guest token instead of firing requests with a dead token.
async function getCustomerAuth(): Promise<StorageValue | null> {
	const jar = await cookies();
	const raw = jar.get(CUSTOMER_COOKIE)?.value;
	if (!raw) return null;
	try {
		const stored = JSON.parse(raw) as StorageValue;
		await jwtVerify(stored.accessToken);
		return stored;
	} catch {
		return null;
	}
}

function createSalesChannel() {
	const clientId = process.env.CL_CLIENT_ID;
	const marketCode = process.env.CL_MARKET_CODE;
	const domain = process.env.CL_DOMAIN;

	if (!clientId || !marketCode) {
		throw new Error(
			"Missing required environment variables: CL_CLIENT_ID, CL_MARKET_CODE",
		);
	}

	return makeSalesChannel(
		{ clientId, scope: `market:code:${marketCode}`, domain },
		{ storage: createMemoryStorage() },
	);
}

// Module-level singleton — one per process, used only for the guest token.
const salesChannel = createSalesChannel();

// Lazy singleton — only initialised when integration env vars are present
let _integration: ReturnType<typeof makeIntegration> | null = null;

function getIntegration() {
	if (_integration) return _integration;
	const clientId = process.env.CL_INTEGRATION_CLIENT_ID;
	const clientSecret = process.env.CL_INTEGRATION_CLIENT_SECRET;
	const domain = process.env.CL_DOMAIN;
	if (!clientId || !clientSecret) {
		throw new Error(
			"Missing required environment variables: CL_INTEGRATION_CLIENT_ID, CL_INTEGRATION_CLIENT_SECRET",
		);
	}
	_integration = makeIntegration(
		{ clientId, clientSecret, domain },
		{ storage: createMemoryStorage() },
	);
	return _integration;
}

async function getAccessToken() {
	// Customer token from cookie takes precedence over the guest token.
	const customerAuth = await getCustomerAuth();
	if (customerAuth) return customerAuth.accessToken;
	const auth = await salesChannel.getAuthorization();
	return auth.accessToken;
}

export async function getClientWithToken() {
	const accessToken = await getAccessToken();
	return { client: createClient(accessToken), accessToken };
}

export async function getClient() {
	const { client } = await getClientWithToken();
	return client;
}

/** Whether the integration application credentials are set. Without them the
 * features that need the integration client are off: the express payment
 * buttons, the Adyen advanced-flow payments and the debug panels. */
export function hasIntegrationCredentials() {
	return !!(
		process.env.CL_INTEGRATION_CLIENT_ID &&
		process.env.CL_INTEGRATION_CLIENT_SECRET
	);
}

export async function getIntegrationClient() {
	const auth = await getIntegration().getAuthorization();
	return createClient(auth.accessToken);
}

/** Returns whether the current token belongs to a customer. */
export async function getAuthOwnerType(): Promise<"guest" | "customer"> {
	const customerAuth = await getCustomerAuth();
	return customerAuth ? "customer" : "guest";
}

/** Authenticates a customer and stores the token in an httpOnly cookie.
 *  Must be called from a Server Action or Route Handler. */
export async function loginCustomerToSalesChannel() {
	const clientId = process.env.CL_CLIENT_ID;
	const marketCode = process.env.CL_MARKET_CODE;
	const domain = process.env.CL_DOMAIN;
	const username = process.env.CL_CUSTOMER_EMAIL;
	const password = process.env.CL_CUSTOMER_PASSWORD;

	if (!clientId || !marketCode || !username || !password) {
		throw new Error(
			"Missing environment variables: CL_CLIENT_ID, CL_MARKET_CODE, CL_CUSTOMER_EMAIL, CL_CUSTOMER_PASSWORD",
		);
	}

	const auth = await authenticate("password", {
		clientId,
		username,
		password,
		scope: `market:code:${marketCode}`,
		domain,
	});

	if (auth.errors?.length) {
		throw new Error(auth.errors[0]?.detail ?? "Login failed");
	}

	const jar = await cookies();
	jar.set(
		CUSTOMER_COOKIE,
		JSON.stringify({
			accessToken: auth.accessToken,
			refreshToken: auth.refreshToken,
			scope: auth.scope,
		}),
		{
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			// Tie the cookie's lifetime to the token's actual expiry so the
			// cookie can't outlive the token it carries.
			maxAge: auth.expiresIn,
		},
	);
}

/** Logs out the customer by deleting the cookie.
 *  Must be called from a Server Action or Route Handler. */
export async function logoutCustomerFromSalesChannel() {
	const jar = await cookies();
	jar.delete(CUSTOMER_COOKIE);
}
