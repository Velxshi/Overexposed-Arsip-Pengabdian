import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/rbac";
import { getSessionCookieOptions, getSessionSecretKey, signLocalSession, SSO_SESSION_COOKIE, type SsoRole } from "@/lib/sso";

const DEV_USERS: Record<SsoRole, { sub: string; name: string; email: string; nip: string | null }> = {
  Dosen: {
    sub: "00000000-0000-4000-8000-000000000001",
    name: "Dosen Penguji (Dev)",
    email: "dosen.dev@upi.edu",
    nip: "199001012020121001",
  },
  Kaprodi: {
    sub: "00000000-0000-4000-8000-000000000002",
    name: "Kaprodi Penguji (Dev)",
    email: "kaprodi.dev@upi.edu",
    nip: "199001012020121002",
  },
  Admin: {
    sub: "00000000-0000-4000-8000-000000000003",
    name: "Staf Admin Penguji (Dev)",
    email: "admin.dev@upi.edu",
    nip: "199001012020121003",
  },
  Mahasiswa: {
    sub: "00000000-0000-4000-8000-000000000004",
    name: "Mahasiswa Penguji (Dev)",
    email: "mahasiswa.dev@upi.edu",
    nip: null,
  },
  Umum: {
    sub: "00000000-0000-4000-8000-000000000005",
    name: "Pengunjung Umum (Dev)",
    email: "umum.dev@upi.edu",
    nip: null,
  },
};

function sanitizeNextPath(rawNext: string | null, fallback: string): string {
  if (!rawNext) return fallback;
  const trimmed = rawNext.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }
  return trimmed;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Rute login pengembangan dinonaktifkan di production." }, { status: 403 });
  }

  try {
    getSessionSecretKey();
  } catch {
    return NextResponse.json({ error: "Konfigurasi SESSION_SECRET pada server belum diatur." }, { status: 500 });
  }

  const roleParam = request.nextUrl.searchParams.get("role");
  const role: SsoRole = roleParam ? normalizeRole(roleParam) : "Dosen";
  const dummyUser = DEV_USERS[role];
  const mode = request.nextUrl.searchParams.get("mode");
  const defaultRedirect = role === "Admin" ? "/arsip" : "/tridharma";
  const redirectPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"), defaultRedirect);

  try {
    let dosenId: number | null = null;

    if (role === "Dosen" || role === "Kaprodi") {
      const dosen = await db.dosen.upsert({
        where: { user_id: dummyUser.sub },
        update: {
          nama: dummyUser.name,
          nama_normal: dummyUser.name.toLowerCase().trim(),
        },
        create: {
          user_id: dummyUser.sub,
          nama: dummyUser.name,
          nama_normal: dummyUser.name.toLowerCase().trim(),
        },
      });
      dosenId = dosen.id;
    }

    await db.logAktivitas.create({
      data: {
        user_id: dummyUser.sub,
        user_nama: dummyUser.name,
        aksi: "LOGIN_DEV",
        objek: "AUTH",
        detail: `Login sementara berhasil dengan role ${role}`,
      },
    });

    const expTime = Math.floor(Date.now() / 1000) + 60 * 60 * 2;
    const session = await signLocalSession(
      {
        sub: dummyUser.sub,
        dosen_id: dosenId,
        name: dummyUser.name,
        email: dummyUser.email,
        nip: dummyUser.nip,
        role,
      },
      expTime,
    );

    const response =
      mode === "json"
        ? NextResponse.json({
            message: "Login pengembangan berhasil.",
            redirectPath,
            user: {
              sub: dummyUser.sub,
              dosen_id: dosenId,
              name: dummyUser.name,
              email: dummyUser.email,
              role,
            },
          })
        : NextResponse.redirect(new URL(redirectPath, request.url));

    response.cookies.set(SSO_SESSION_COOKIE, session, getSessionCookieOptions(60 * 60 * 2));

    return response;
  } catch (err) {
    console.error("Kesalahan pada /api/dev-login:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Gagal memproses login pengujian: ${detail}`,
      },
      { status: 500 },
    );
  }
}
