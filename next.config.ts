import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Next's dev server answers /_next/* with 403 for any Origin not listed here,
	// which leaves a page served but never hydrated and reports nothing in the
	// browser — so every hostname the dev server is reached by must be declared.
	allowedDevOrigins: [
		// Public tunnel (ngrok or similar) used to reach this dev server from
		// outside the machine. Set DEV_TUNNEL_HOST in .env.local to the tunnel's
		// hostname, without scheme or port.
		...(process.env.DEV_TUNNEL_HOST ? [process.env.DEV_TUNNEL_HOST] : []),
	],
};

export default nextConfig;
