import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

// Simpan instance JWKS di memori (lazy initialization) agar tidak dieksekusi saat build Vercel
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  const ssoUrl = process.env.SSO_URL;
  if (!ssoUrl) {
    throw new Error("Variabel environment SSO_URL belum diatur.");
  }
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL("/api/sso/jwks", ssoUrl));
  }
  return jwksCache;
}

interface SsoJwtPayload {
  sub: string;
  name: string;
  email: string;
  nip?: string;
  role: "Dosen" | "Kaprodi" | "Admin";
  exp?: number;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  let tx: { state?: string; verifier?: string } = {};
  try {
    tx = JSON.parse(request.cookies.get("sso_tx")?.value ?? "{}");
  } catch {
    return NextResponse.json({ error: "Data sesi login (sso_tx) rusak." }, { status: 400 });
  }

  // 1. Cegah CSRF
  if (!tx.state || tx.state !== params.get("state")) {
    return NextResponse.json({ error: "State tidak cocok." }, { status: 400 });
  }

  // 2. Error handling jika role tidak sesuai dari SSO
  if (params.get("error")) {
    return NextResponse.json({ error: params.get("error_description") ?? "Akses ditolak." }, { status: 403 });
  }

  const ssoUrl = process.env.SSO_URL;
  const clientId = process.env.SSO_CLIENT_ID;
  const clientSecret = process.env.SSO_CLIENT_SECRET;
  const redirectUri = process.env.SSO_REDIRECT_URI;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!ssoUrl || !clientId || !clientSecret || !redirectUri || !sessionSecret) {
    return NextResponse.json({ error: "Konfigurasi environment SSO pada server belum lengkap." }, { status: 500 });
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
      return NextResponse.json({ error: "Login SSO gagal saat menukar token." }, { status: 401 });
    }

    const tokens = await res.json();

    // 4. Memverifikasi tanda tangan, penerbit (iss), tujuan (aud), dan masa berlaku JWT secara lokal
    const { payload } = await jwtVerify<SsoJwtPayload>(tokens.access_token, getJwks(), {
      issuer: ssoUrl,
      audience: clientId,
      algorithms: ["RS256"],
    });

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
    const session = await new SignJWT({
      sub: payload.sub,
      dosen_id: dosenId,
      name: payload.name,
      email: payload.email,
      nip: payload.nip ?? null,
      role: payload.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(payload.exp!)
      .sign(new TextEncoder().encode(sessionSecret));

    const isProd = process.env.NODE_ENV === "production";

    // 8. Redirect ke halaman utama / dashboard sesuai role
    const redirectPath = payload.role === "Admin" ? "/arsip" : "/tridharma";
    const response = NextResponse.redirect(new URL(redirectPath, request.url));

    response.cookies.set("app_session", session, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });
    response.cookies.set("sso_refresh", tokens.refresh_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });
    response.cookies.delete("sso_tx");

    return response;
  } catch (error) {
    console.error("Kesalahan pada saat callback SSO:", error);
    return NextResponse.json({ error: "Terjadi kesalahan saat memverifikasi sesi SSO." }, { status: 500 });
  }
}
