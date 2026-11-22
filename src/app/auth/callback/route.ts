import { NextResponse, type NextRequest } from "next/server";
import { recordAuthLog } from "@/lib/auth-log";
import { db } from "@/lib/db";
import {
  encryptRefreshToken,
  getRefreshCookieOptions,
  getSessionCookieOptions,
  getSessionSecretKey,
  getSsoConfig,
  isValidHttpUrl,
  signLocalSession,
  SSO_REFRESH_COOKIE,
  SSO_SESSION_COOKIE,
  SSO_TX_COOKIE,
  verifySsoAccessToken,
} from "@/lib/sso";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  let tx: { state?: string; verifier?: string } = {};
  try {
    tx = JSON.parse(request.cookies.get(SSO_TX_COOKIE)?.value ?? "{}");
  } catch {
    await recordAuthLog({
      aksi: "login_gagal",
      detail: "Data cookie sesi login (sso_tx) rusak saat callback SSO.",
    });
    return NextResponse.json({ message: "Data sesi login (sso_tx) rusak." }, { status: 400 });
  }

  // 1. Cegah CSRF
  if (!tx.state) {
    await recordAuthLog({
      aksi: "login_gagal",
      detail: "Cookie sso_tx tidak ditemukan saat callback SSO.",
    });
    return NextResponse.json(
      {
        message: "Cookie sesi login (sso_tx) tidak ditemukan. Pastikan host saat membuka /sso/login sama dengan SSO_REDIRECT_URI.",
      },
      { status: 400 },
    );
  }
  if (tx.state !== params.get("state")) {
    await recordAuthLog({
      aksi: "login_gagal",
      detail: "Parameter state callback SSO tidak cocok.",
    });
    return NextResponse.json({ message: "State tidak cocok." }, { status: 400 });
  }

  // 2. Error handling jika role tidak sesuai atau login dibatalkan di SSO
  const ssoCallbackError = params.get("error");
  if (ssoCallbackError) {
    const errorDescription = params.get("error_description") ?? "Akses ditolak.";
    await recordAuthLog({
      aksi: "login_gagal",
      detail: `SSO menolak callback (${ssoCallbackError}): ${errorDescription}`,
    });
    return NextResponse.json({ message: errorDescription }, { status: 403 });
  }

  const { ssoUrl, clientId, clientSecret, redirectUri } = getSsoConfig();

  try {
    getSessionSecretKey();
  } catch {
    return NextResponse.json({ message: "Konfigurasi SESSION_SECRET pada server belum diatur." }, { status: 500 });
  }

  if (!ssoUrl || !isValidHttpUrl(ssoUrl) || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        message: "Konfigurasi environment SSO pada server belum lengkap atau tidak valid.",
      },
      { status: 500 },
    );
  }

  const code = params.get("code")?.trim();
  if (!code) {
    await recordAuthLog({
      aksi: "login_gagal",
      detail: "Parameter code tidak ditemukan pada callback SSO.",
    });
    return NextResponse.json({ message: "Parameter code tidak ditemukan pada callback SSO." }, { status: 400 });
  }

  try {
    // 3. Menukar kode sekali pakai dengan access_token dan refresh_token ke server SSO
    const res = await fetch(new URL("/api/sso/token", ssoUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: tx.verifier ?? "",
      }),
    });

    if (!res.ok) {
      let ssoError: string | undefined;
      let ssoDescription: string | undefined;
      try {
        const errBody = (await res.json()) as {
          error?: string;
          error_description?: string;
        };
        ssoError = errBody.error;
        ssoDescription = errBody.error_description;
      } catch {
        ssoError = undefined;
      }

      console.error("Penukaran token SSO gagal:", {
        status: res.status,
        redirected: res.redirected,
        finalUrl: res.url,
        ssoError,
        ssoDescription,
      });

      await recordAuthLog({
        aksi: "login_gagal",
        detail: `Penukaran token SSO gagal (HTTP ${res.status}, ${ssoError ?? "unknown"}): ${ssoDescription ?? "tanpa keterangan"}`,
      });

      return NextResponse.json(
        {
          message: "Login SSO gagal saat menukar token.",
          ssoStatus: res.status,
          ssoError: ssoError ?? null,
          ssoDescription: ssoDescription ?? null,
        },
        { status: 401 },
      );
    }

    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };

    // 4. Memverifikasi tanda tangan RS256, penerbit (iss), tujuan (aud), dan masa berlaku JWT
    const payload = await verifySsoAccessToken(tokens.access_token, ssoUrl, clientId);

    // 5. Cari baris dosen berdasarkan user_id (PRD 5.1: tidak membuat/menimpa baris saat login)
    let dosenId: number | null = null;
    if (payload.role === "Dosen" || payload.role === "Kaprodi" || payload.role === "Staff Kaprodi" || payload.role === "Admin") {
      const dosen = await db.dosen.findUnique({
        where: {
          user_id: payload.sub,
        },
        select: {
          id: true,
        },
      });

      dosenId = dosen?.id ?? null;
    }

    // 6. Catat aktivitas login ke tabel LogAktivitas
    await recordAuthLog({
      aksi: "login",
      userId: payload.sub,
      userName: payload.name,
      detail: `Login berhasil dengan role ${payload.role}`,
    });

    // 7. Buat JWT sesi lokal (berlaku 15 menit sesuai masa aktif access_token)
    const expTime = payload.exp ?? Math.floor(Date.now() / 1000) + 900;
    const session = await signLocalSession(
      {
        sub: payload.sub,
        dosen_id: dosenId,
        name: payload.name,
        email: payload.email,
        nip: payload.nip ?? null,
        role: payload.role,
      },
      expTime,
    );

    // 8. Redirect ke halaman utama / dashboard sesuai role
    const redirectPath = payload.role === "Staff Kaprodi" || payload.role === "Admin" ? "/arsip" : "/tridharma";
    const response = NextResponse.redirect(new URL(redirectPath, request.url));

    response.cookies.set(SSO_SESSION_COOKIE, session, getSessionCookieOptions());

    if (tokens.refresh_token) {
      const encryptedRefresh = await encryptRefreshToken(tokens.refresh_token);
      response.cookies.set(SSO_REFRESH_COOKIE, encryptedRefresh, getRefreshCookieOptions());
    }

    response.cookies.delete(SSO_TX_COOKIE);

    return response;
  } catch (error) {
    console.error("Kesalahan pada saat callback SSO:", error);
    await recordAuthLog({
      aksi: "login_gagal",
      detail: `Verifikasi sesi SSO gagal: ${error instanceof Error ? error.message : String(error)}`,
    });
    return NextResponse.json({ message: "Terjadi kesalahan saat memverifikasi sesi SSO." }, { status: 500 });
  }
}
