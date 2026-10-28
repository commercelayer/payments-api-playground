import { getClientWithToken } from "@/lib/client"
import { organizationSlugFromToken } from "@/lib/token"

/** Shows which sandbox the playground talks to: the organization the access
 * token belongs to and the market it is scoped to. Renders nothing when there is
 * no token, so a misconfigured env doesn't also break the layout of the error
 * page. */
export async function AppFooter() {
  let organizationSlug: string | null = null
  try {
    const { accessToken } = await getClientWithToken()
    organizationSlug = organizationSlugFromToken(accessToken)
  } catch {
    return null
  }
  const marketCode = process.env.CL_MARKET_CODE

  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 text-xs text-gray-500">
        <span>
          Organization{" "}
          <span className="font-mono text-gray-900">
            {organizationSlug ?? "unknown"}
          </span>
        </span>
        <span>
          Market{" "}
          <span className="font-mono text-gray-900">
            {marketCode ?? "unknown"}
          </span>
        </span>
      </div>
    </footer>
  )
}
