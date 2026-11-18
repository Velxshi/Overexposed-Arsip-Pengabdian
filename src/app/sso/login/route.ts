import { createHash, randomBytes } from "node:crypto";
import { connection, NextResponse } from "next/server";
import {
  getSsoConfig,
  getSessionCookieOptions,
  isValidHttpUrl,
  SSO_TX_COOKIE,
} from "@/lib/sso";

export async function GET() {
  await connection();

  try {
    const { ssoUrl, clientId, redirectUri } = getSsoConfig();

    if (!ssoUrl || !isValidHttpUrl(ssoUrl) || !clientId || !redirectUri) {
      return NextResponse.json(
        {
          error: "Konfigurasi environment SSO pada server belum lengkap atau tidak valid.",
          detail: {
            hasValidSsoUrl: Boolean(ssoUrl && isValidHttpUrl(ssoUrl)),
            hasClientId: Boolean(clientId),
            hasRedirectUri: Boolean(redirectUri),
          },
        },
        { status: 500 }
      );
    }

    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const url = new URL("/api/sso/authorize", ssoUrl);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const response = NextResponse.redirect(url);
    response.cookies.set(
      SSO_TX_COOKIE,
      JSON.stringify({ state, verifier }),
      getSessionCookieOptions(600)
    );

    return response;
  } catch (err) {
    console.error("Kesalahan pada rute /sso/login:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memulai proses login SSO." },
      { status: 500 }
    );
  }
}
