import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ARSIP_DETAIL_SELECT, formatArsipDetail, parseArsipValidasiFilters, requireArsipValidator } from "@/lib/arsip";

export async function GET(request: NextRequest) {
  const auth = await requireArsipValidator();
  if (!auth.ok) return auth.response;

  const parsed = parseArsipValidasiFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    const { filters, where } = parsed;

    const [rows, total] = await Promise.all([
      db.arsip.findMany({
        where,
        orderBy: [{ tanggal_arsip: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: ARSIP_DETAIL_SELECT,
      }),
      db.arsip.count({ where }),
    ]);

    return NextResponse.json(
      {
        items: rows.map((row) => formatArsipDetail(row)),
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET Validasi Arsip:", error);
    return NextResponse.json({ message: "Gagal mengambil daftar validasi arsip." }, { status: 500 });
  }
}
