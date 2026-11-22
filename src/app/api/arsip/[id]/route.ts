import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ARSIP_DETAIL_SELECT, canDeleteArsip, findKategoriForArsip, formatArsipDetail, isNomorArsipTaken, parseArsipIdParam, parseArsipJsonBody, parsePatchArsipPayload, requireArsipManager, requireArsipViewer } from "@/lib/arsip";
import { catatLog } from "@/lib/log-aktivitas";

export async function GET(_request: NextRequest, context: RouteContext<"/api/arsip/[id]">) {
  const auth = await requireArsipViewer();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseArsipIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID arsip tidak valid." }, { status: 400 });
  }

  try {
    const arsip = await db.arsip.findUnique({
      where: { id },
      select: ARSIP_DETAIL_SELECT,
    });

    if (!arsip) {
      return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ data: formatArsipDetail(arsip) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET Arsip:", error);
    return NextResponse.json({ message: "Gagal mengambil detail arsip." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/arsip/[id]">) {
  const auth = await requireArsipManager();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseArsipIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID arsip tidak valid." }, { status: 400 });
  }

  const jsonBody = await parseArsipJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;

  const parsed = parsePatchArsipPayload(jsonBody.data);
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

    if (parsed.data.kategori_id !== undefined) {
      const kategori = await findKategoriForArsip(parsed.data.kategori_id);
      if (!kategori) {
        return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 400 });
      }
    }

    if (parsed.data.nomor_arsip !== undefined && (await isNomorArsipTaken(parsed.data.nomor_arsip, id))) {
      return NextResponse.json({ message: "Nomor arsip sudah dipakai." }, { status: 409 });
    }

    // PRD 6.3: setiap perubahan isi arsip mengembalikan status_validasi ke Pending.
    const arsip = await db.arsip.update({
      where: { id },
      data: {
        ...parsed.data,
        status_validasi: "Pending",
        catatan_validasi: null,
      },
      select: ARSIP_DETAIL_SELECT,
    });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "ubah",
      objek: "arsip",
      detail: `${arsip.nomor_arsip} - ${arsip.judul}`,
    });

    return NextResponse.json({
      message: "Arsip berhasil diperbarui dan status validasi dikembalikan ke Pending.",
      data: formatArsipDetail(arsip),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json({ message: "Nomor arsip sudah dipakai." }, { status: 409 });
      }
      if (error.code === "P2003") {
        return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 400 });
      }
      if (error.code === "P2025") {
        return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
      }
    }
    console.error("PATCH Arsip:", error);
    return NextResponse.json({ message: "Gagal memperbarui arsip." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/arsip/[id]">) {
  const auth = await requireArsipManager();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseArsipIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID arsip tidak valid." }, { status: 400 });
  }

  try {
    const existing = await db.arsip.findUnique({
      where: { id },
      select: {
        id: true,
        nomor_arsip: true,
        judul: true,
        tanggal_arsip: true,
        retensi_aktif_tahun: true,
        retensi_inaktif_tahun: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
    }

    const deleteCheck = canDeleteArsip(existing);
    if (!deleteCheck.allowed) {
      return NextResponse.json(
        {
          message: `Arsip tidak dapat dihapus karena status retensinya masih ${deleteCheck.retensi.status} (hanya arsip berstatus Dimusnahkan yang boleh dihapus).`,
        },
        { status: 409 },
      );
    }

    await db.arsip.delete({ where: { id } });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "hapus",
      objek: "arsip",
      detail: `${existing.nomor_arsip} - ${existing.judul}`,
    });

    return NextResponse.json({
      message: "Arsip berhasil dihapus permanen.",
      data: {
        id: existing.id,
        nomor_arsip: existing.nomor_arsip,
        judul: existing.judul,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Arsip tidak ditemukan." }, { status: 404 });
    }
    console.error("DELETE Arsip:", error);
    return NextResponse.json({ message: "Gagal menghapus arsip." }, { status: 500 });
  }
}
