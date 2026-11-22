import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/rbac";
import { getSession } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store" };

// proxy.ts membiarkan rute ini lewat tanpa sesi, jadi 401 harus dikembalikan di sini.
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { authenticated: false, message: "Silakan login terlebih dahulu." },
      { status: 401, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        sub: session.sub,
        name: session.name,
        email: session.email,
        nip: session.nip,
        role: normalizeRole(session.role),
        dosen_id: session.dosen_id,
      },
      session_expires_at: session.exp ? new Date(session.exp * 1000).toISOString() : null,
    },
    { headers: NO_STORE },
  );
}
