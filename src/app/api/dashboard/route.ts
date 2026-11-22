import { NextRequest, NextResponse } from "next/server";
import { requireArsipViewer } from "@/lib/arsip";
import { getDashboardArsip, parseDashboardFilters } from "@/lib/dashboard";

// Staff Kaprodi, Kaprodi, dan Dosen boleh melihat (PRD 6.1). Mahasiswa dan Umum mendapat 403.
export async function GET(request: NextRequest) {
  const auth = await requireArsipViewer();
  if (!auth.ok) return auth.response;

  try {
    const result = await getDashboardArsip(parseDashboardFilters(request.nextUrl.searchParams));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET Dashboard:", error);
    return NextResponse.json({ message: "Gagal mengambil data dashboard." }, { status: 500 });
  }
}
