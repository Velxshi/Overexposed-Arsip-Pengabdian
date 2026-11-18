import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  getRefreshCookieOptions,
  getSessionCookieOptions,
  getSessionSecretKey,
  refreshWithSsoSingleFlight,
  signLocalSession,
  SSO_REFRESH_COOKIE,
  SSO_SESSION_COOKIE,
} from "@/lib/sso";

export async function POST(request: NextRequest) {
  try {
    getSessionSecretKey();
  } catch {
    return NextResponse.json(
      { error: "Konfigurasi SESSION_SECRET pada server belum diatur." },
      { status: 500 }
    );
  }

  const encryptedRefresh = request.cookies.get(SSO_REFRESH_COOKIE)?.value;
  if (!encryptedRefresh) {
    return NextResponse.json(
      { error: "Sesi tidak dapat diperbarui." },
      { status: 401 }
    );
  }

  const refreshToken = await decryptRefreshToken(encryptedRefresh);
  if (!refreshToken) {
    const errRes = NextResponse.json(
      { error: "Refresh token tidak valid." },
      { status: 401 }
    );
    errRes.cookies.delete(SSO_SESSION_COOKIE);
    errRes.cookies.delete(SSO_REFRESH_COOKIE);
    return errRes;
  }

  const result = await refreshWithSsoSingleFlight(refreshToken);

  if (!result.ok) {
    if (result.reason === "revoked") {
      const errRes = NextResponse.json(
        { error: "Refresh token tidak berlaku." },
        { status: 401 }
      );
      errRes.cookies.delete(SSO_SESSION_COOKIE);
      errRes.cookies.delete(SSO_REFRESH_COOKIE);
      return errRes;
    }

    return NextResponse.json(
      { error: "Layanan SSO sedang tidak tersedia." },
      { status: 502 }
    );
  }

  try {
    const { payload, refreshToken: nextRefreshToken } = result;

    let dosenId: number | null = null;
    if (payload.role === "Dosen" || payload.role === "Kaprodi") {
      const dosen = await db.dosen.findUnique({
        where: { user_id: String(payload.sub) },
        select: { id: true },
      });
      dosenId = dosen?.id ?? null;
    }

    const expTime = payload.exp ?? Math.floor(Date.now() / 1000) + 900;
    const newSession = await signLocalSession(
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

    const encryptedNextRefresh = await encryptRefreshToken(nextRefreshToken);
    const response = NextResponse.json({ message: "Sesi diperbarui" });

    response.cookies.set(
      SSO_SESSION_COOKIE,
      newSession,
      getSessionCookieOptions()
    );
    response.cookies.set(
      SSO_REFRESH_COOKIE,
      encryptedNextRefresh,
      getRefreshCookieOptions()
    );

    return response;
  } catch (err) {
    console.error("Kesalahan saat memperbarui sesi:", err);
    return NextResponse.json(
      { error: "Gagal memperbarui sesi." },
      { status: 500 }
    );
  }
}
