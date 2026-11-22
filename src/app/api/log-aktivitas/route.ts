import { NextRequest, NextResponse } from "next/server";
import { listLogAktivitas, parseLogAktivitasFilters } from "@/lib/log-aktivitas-daftar";
import { getArsipPermissions } from "@/lib/rbac";
import { getSession } from "@/lib/session";

// Hanya Staff Kaprodi dan Kaprodi (PRD 6.4). proxy.ts juga membatasi rute ini.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Silakan login terlebih dahulu." }, { status: 401 });
  }

  if (!getArsipPermissions(session).canViewLogAktivitas) {
    return NextResponse.json({ message: "Anda tidak memiliki izin untuk melihat log aktivitas." }, { status: 403 });
  }

  const parsed = parseLogAktivitasFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    const result = await listLogAktivitas(parsed.filters);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET Log Aktivitas:", error);
    return NextResponse.json({ message: "Gagal mengambil log aktivitas." }, { status: 500 });
  }
}
