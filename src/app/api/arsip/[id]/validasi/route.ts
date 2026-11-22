import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ARSIP_DETAIL_SELECT, formatArsipDetail, parseArsipIdParam, parseArsipJsonBody, parseValidasiArsipPayload, requireArsipValidator } from "@/lib/arsip";
import { catatLog } from "@/lib/log-aktivitas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/arsip/[id]/validasi">) {
  const auth = await requireArsipValidator();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseArsipIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID arsip tidak valid." }, { status: 400 });
  }

  const jsonBody = await parseArsipJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;

  const parsed = parseValidasiArsipPayload(jsonBody.data);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    const existing = await db.arsip.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
    }

    const arsip = await db.arsip.update({
      where: { id },
      data: {
        status_validasi: parsed.data.status_validasi,
        catatan_validasi: parsed.data.catatan_validasi,
      },
      select: ARSIP_DETAIL_SELECT,
    });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "validasi",
      objek: "arsip",
      detail: `${arsip.nomor_arsip} - ${arsip.judul} (${arsip.status_validasi})`,
    });

    return NextResponse.json({
      message:
        arsip.status_validasi === "Diterima"
          ? "Arsip berhasil divalidasi (Diterima)."
          : "Arsip berhasil divalidasi (Ditolak).",
      data: formatArsipDetail(arsip),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
    }
    console.error("PATCH Validasi Arsip:", error);
    return NextResponse.json({ message: "Gagal memvalidasi arsip." }, { status: 500 });
  }
}
