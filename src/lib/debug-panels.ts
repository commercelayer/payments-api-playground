/** The order page's debug panels (gift cards, payment sessions, placeable
 * check) and the gift card actions behind them. They act with the integration
 * application's credentials on behalf of whoever opens the page, so on a public
 * deploy any visitor could create and delete gift cards and read the
 * organization's payment sessions. Always on in `next dev`; a build only turns
 * them on with `CL_DEBUG_PANELS=1`. */
export const DEBUG_PANELS_ENABLED =
	process.env.NODE_ENV === "development" || process.env.CL_DEBUG_PANELS === "1";
