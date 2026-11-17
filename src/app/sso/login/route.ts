import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const currentOrigin = request.nextUrl.origin;
    const ssoUrl = process.env.SSO_URL?.trim();
    const clientId = process.env.SSO_CLIENT_ID?.trim();
    const redirectUri = process.env.SSO_REDIRECT_URI?.trim();

    if (!ssoUrl || !clientId || !redirectUri) {
      return NextResponse.json(
        {
          error: "Variabel environment SSO belum terbaca di Vercel.",
          detail: {
            hasSsoUrl: Boolean(ssoUrl),
            hasClientId: Boolean(clientId),
            hasRedirectUri: Boolean(redirectUri),
            origin: currentOrigin,
          },
        },
        { status: 500 },
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
    response.cookies.set("sso_tx", JSON.stringify({ state, verifier }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      {
        error: "Terjadi kesalahan di rute /sso/login",
        pesan: err instanceof Error ? err.message : String(err),
        nilaiSsoUrlSaatIni: process.env.SSO_URL ?? "KOSONG",
      },
      { status: 500 },
    );
  }
}
