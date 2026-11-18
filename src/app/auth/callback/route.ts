import { NextResponse, type NextRequest } from "next/server";
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
    return NextResponse.json(
      { error: "Data sesi login (sso_tx) rusak." },
      { status: 400 }
    );
  }

  // 1. Cegah CSRF
  if (!tx.state || tx.state !== params.get("state")) {
    return NextResponse.json({ error: "State tidak cocok." }, { status: 400 });
  }

  // 2. Error handling jika role tidak sesuai atau login dibatalkan di SSO
  if (params.get("error")) {
    return NextResponse.json(
      { error: params.get("error_description") ?? "Akses ditolak." },
      { status: 403 }
    );
  }

  const { ssoUrl, clientId, clientSecret, redirectUri } = getSsoConfig();

  try {
    getSessionSecretKey();
  } catch {
    return NextResponse.json(
      { error: "Konfigurasi SESSION_SECRET pada server belum diatur." },
      { status: 500 }
    );
  }

  if (!ssoUrl || !isValidHttpUrl(ssoUrl) || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Konfigurasi environment SSO pada server belum lengkap atau tidak valid." },
      { status: 500 }
    );
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
        code: params.get("code") ?? "",
        redirect_uri: redirectUri,
        code_verifier: tx.verifier ?? "",
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Login SSO gagal saat menukar token." },
        { status: 401 }
      );
    }

    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };

    // 4. Memverifikasi tanda tangan RS256, penerbit (iss), tujuan (aud), dan masa berlaku JWT
    const payload = await verifySsoAccessToken(
      tokens.access_token,
      ssoUrl,
      clientId
    );

    let dosenId: number | null = null;

    // 5. Sinkronisasi ke tabel Dosen jika role-nya Dosen atau Kaprodi
    if (payload.role === "Dosen" || payload.role === "Kaprodi") {
      const namaNormal = payload.name.toLowerCase().trim();

      const dosen = await db.dosen.upsert({
        where: {
          user_id: payload.sub,
        },
        update: {
          nama: payload.name,
          nama_normal: namaNormal,
        },
        create: {
          user_id: payload.sub,
          nama: payload.name,
          nama_normal: namaNormal,
        },
      });

      dosenId = dosen.id;
    }

    // 6. Catat aktivitas login ke tabel LogAktivitas
    await db.logAktivitas.create({
      data: {
        user_id: payload.sub,
        user_nama: payload.name,
        aksi: "LOGIN_SSO",
        objek: "AUTH",
        detail: `Login berhasil dengan role ${payload.role}`,
      },
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
      expTime
    );

    // 8. Redirect ke halaman utama / dashboard sesuai role
    const redirectPath = payload.role === "Admin" ? "/arsip" : "/tridharma";
    const response = NextResponse.redirect(new URL(redirectPath, request.url));

    response.cookies.set(
      SSO_SESSION_COOKIE,
      session,
      getSessionCookieOptions()
    );

    if (tokens.refresh_token) {
      const encryptedRefresh = await encryptRefreshToken(tokens.refresh_token);
      response.cookies.set(
        SSO_REFRESH_COOKIE,
        encryptedRefresh,
        getRefreshCookieOptions()
      );
    }

    response.cookies.delete(SSO_TX_COOKIE);

    return response;
  } catch (error) {
    console.error("Kesalahan pada saat callback SSO:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memverifikasi sesi SSO." },
      { status: 500 }
    );
  }
}
