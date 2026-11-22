import { NextResponse, type NextRequest } from "next/server";
import { cariDosenIdSesi } from "@/lib/dosen-sesi";
import { evaluateRouteRbac } from "@/lib/rbac";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  getRefreshCookieOptions,
  getSessionCookieOptions,
  refreshWithSsoSingleFlight,
  signLocalSession,
  SSO_REFRESH_COOKIE,
  SSO_SESSION_COOKIE,
  verifyLocalSession,
  type LocalSessionPayload,
} from "@/lib/sso";

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function attachCookies(
  response: NextResponse,
  cookiesToSet: { session?: string; refresh?: string } | null,
  clearStale: boolean
) {
  if (cookiesToSet?.session) {
    response.cookies.set(
      SSO_SESSION_COOKIE,
      cookiesToSet.session,
      getSessionCookieOptions()
    );
  }
  if (cookiesToSet?.refresh) {
    response.cookies.set(
      SSO_REFRESH_COOKIE,
      cookiesToSet.refresh,
      getRefreshCookieOptions()
    );
  }
  if (clearStale) {
    response.cookies.delete(SSO_SESSION_COOKIE);
    response.cookies.delete(SSO_REFRESH_COOKIE);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let activeSession: LocalSessionPayload | null = null;
  let refreshedCookies: { session: string; refresh: string } | null = null;
  let shouldClearStaleCookies = false;

  const sessionCookie = request.cookies.get(SSO_SESSION_COOKIE)?.value;
  if (sessionCookie) {
    activeSession = await verifyLocalSession(sessionCookie);
  }

  // Jika sesi lokal belum ada atau sudah kedaluwarsa, coba refresh menggunakan sso_refresh
  if (!activeSession) {
    const encryptedRefresh = request.cookies.get(SSO_REFRESH_COOKIE)?.value;
    if (encryptedRefresh) {
      const refreshToken = await decryptRefreshToken(encryptedRefresh);

      if (refreshToken) {
        const result = await refreshWithSsoSingleFlight(refreshToken);

        if (result.ok) {
          const previousSession = sessionCookie
            ? await verifyLocalSession(sessionCookie, { allowExpired: true })
            : null;

          const expTime =
            result.payload.exp ?? Math.floor(Date.now() / 1000) + 900;

          // Dicari ulang supaya baris dosen yang dibuat setelah login ikut terbaca.
          const dosenId = await cariDosenIdSesi(
            result.payload.sub,
            result.payload.role,
            previousSession?.dosen_id ?? null
          );

          activeSession = {
            sub: result.payload.sub,
            dosen_id: dosenId,
            name: result.payload.name,
            email: result.payload.email,
            nip: result.payload.nip ?? null,
            role: result.payload.role,
            exp: expTime,
          };

          const [nextSessionJwt, encryptedNextRefresh] = await Promise.all([
            signLocalSession(activeSession, expTime),
            encryptRefreshToken(result.refreshToken),
          ]);

          refreshedCookies = {
            session: nextSessionJwt,
            refresh: encryptedNextRefresh,
          };
        } else if (result.reason === "revoked") {
          shouldClearStaleCookies = true;
        }
      } else {
        shouldClearStaleCookies = true;
      }
    }
  }

  const decision = evaluateRouteRbac(pathname, request.method, activeSession);

  if (!decision.allowed) {
    if (isApiPath(pathname)) {
      const status = decision.reason === "unauthenticated" ? 401 : 403;
      const errorMessage =
        decision.reason === "unauthenticated"
          ? "Silakan login terlebih dahulu."
          : "Anda tidak memiliki izin untuk mengakses resource ini.";

      return attachCookies(
        NextResponse.json({ message: errorMessage }, { status }),
        refreshedCookies,
        shouldClearStaleCookies
      );
    }

    if (decision.reason === "unauthenticated") {
      return attachCookies(
        NextResponse.redirect(new URL("/sso/login", request.url)),
        null,
        shouldClearStaleCookies
      );
    }

    return attachCookies(
      NextResponse.rewrite(new URL("/akses-ditolak", request.url), {
        status: 403,
      }),
      refreshedCookies,
      shouldClearStaleCookies
    );
  }

  if (refreshedCookies) {
    const requestHeaders = new Headers(request.headers);
    const forwardedCookies = request.cookies
      .getAll()
      .filter(
        (c) => c.name !== SSO_SESSION_COOKIE && c.name !== SSO_REFRESH_COOKIE
      )
      .map((c) => `${c.name}=${c.value}`);
    forwardedCookies.push(`${SSO_SESSION_COOKIE}=${refreshedCookies.session}`);
    forwardedCookies.push(`${SSO_REFRESH_COOKIE}=${refreshedCookies.refresh}`);
    requestHeaders.set("cookie", forwardedCookies.join("; "));

    return attachCookies(
      NextResponse.next({ request: { headers: requestHeaders } }),
      refreshedCookies,
      false
    );
  }

  return attachCookies(NextResponse.next(), null, shouldClearStaleCookies);
}

export const config = {
  matcher: [
    "/((?!sso/|auth/|api/dev-login|_next/static|_next/image|favicon.ico|icons/).*)",
  ],
};
