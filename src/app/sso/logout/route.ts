import { NextResponse, type NextRequest } from "next/server";
import {
  getSsoConfig,
  SSO_REFRESH_COOKIE,
  SSO_SESSION_COOKIE,
  SSO_TX_COOKIE,
} from "@/lib/sso";

function isAllowedSsoOrigin(url: string): boolean {
  return (
    url.startsWith("https://") ||
    url.startsWith("http://localhost") ||
    url.startsWith("http://127.0.0.1")
  );
}

export async function GET(request: NextRequest) {
  const { ssoUrl, clientId, postLogoutUri } = getSsoConfig();
  const fallbackHome = new URL("/", request.url).toString();
  const logoutRedirectTarget = postLogoutUri || fallbackHome;

  let targetRedirect = new URL("/", request.url);

  if (ssoUrl && isAllowedSsoOrigin(ssoUrl) && clientId) {
    targetRedirect = new URL("/api/sso/logout", ssoUrl);
    targetRedirect.search = new URLSearchParams({
      client_id: clientId,
      post_logout_redirect_uri: logoutRedirectTarget,
    }).toString();
  }

  const response = NextResponse.redirect(targetRedirect);
  response.cookies.delete(SSO_SESSION_COOKIE);
  response.cookies.delete(SSO_REFRESH_COOKIE);
  response.cookies.delete(SSO_TX_COOKIE);

  return response;
}
