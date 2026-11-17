import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

// Wajib agar Next.js selalu membuat state dan verifier baru di setiap klik login
export const dynamic = "force-dynamic";

export async function GET() {
  const ssoUrl = process.env.SSO_URL;
  const clientId = process.env.SSO_CLIENT_ID;
  const redirectUri = process.env.SSO_REDIRECT_URI;

  if (!ssoUrl || !clientId || !redirectUri) {
    return NextResponse.json({ error: "Konfigurasi environment SSO (SSO_URL, SSO_CLIENT_ID, SSO_REDIRECT_URI) belum lengkap." }, { status: 500 });
  }

  // 1. Cegah CSRF
  const state = randomBytes(24).toString("base64url");

  // 2. Keamanan PKCE
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  // 3. Susun URL tujuan ke SSO SACIBIRU
  const url = new URL("/api/sso/authorize", ssoUrl);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  // 4. Simpan state dan verifier di cookie lalu alihkan browser
  const response = NextResponse.redirect(url);
  response.cookies.set("sso_tx", JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
