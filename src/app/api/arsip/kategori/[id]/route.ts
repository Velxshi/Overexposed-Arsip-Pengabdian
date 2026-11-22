import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isKategoriKodeTaken, KATEGORI_PUBLIC_SELECT, parseKategoriIdParam, parseKategoriJsonBody, parsePatchKategoriPayload, requireKategoriManager } from "@/lib/kategori";
import { catatLog } from "@/lib/log-aktivitas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/arsip/kategori/[id]">) {
  const auth = await requireKategoriManager();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseKategoriIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID kategori tidak valid." }, { status: 400 });
  }

  const jsonBody = await parseKategoriJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;

  const parsed = parsePatchKategoriPayload(jsonBody.data);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    const existing = await db.kategori.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 404 });
    }

    if (parsed.data.kode && (await isKategoriKodeTaken(parsed.data.kode, id))) {
      return NextResponse.json({ message: "Kode kategori sudah dipakai." }, { status: 409 });
    }

    const kategori = await db.kategori.update({
      where: { id },
      data: parsed.data,
      select: KATEGORI_PUBLIC_SELECT,
    });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "ubah",
      objek: "kategori",
      detail: `${kategori.kode} - ${kategori.nama}`,
    });

    return NextResponse.json({ message: "Kategori berhasil diperbarui.", data: kategori });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json({ message: "Kode kategori sudah dipakai." }, { status: 409 });
      }
      if (error.code === "P2025") {
        return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 404 });
      }
    }
    console.error("PATCH Kategori:", error);
    return NextResponse.json({ message: "Gagal memperbarui kategori." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/arsip/kategori/[id]">) {
  const auth = await requireKategoriManager();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = parseKategoriIdParam(rawId);
  if (id === null) {
    return NextResponse.json({ message: "ID kategori tidak valid." }, { status: 400 });
  }

  try {
    const existing = await db.kategori.findUnique({
      where: { id },
      select: {
        id: true,
        kode: true,
        nama: true,
        _count: { select: { arsip: true } },
      },
    });

    if (!existing) {
      return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 404 });
    }

    if (existing._count.arsip > 0) {
      return NextResponse.json({ message: "Kategori tidak dapat dihapus karena masih digunakan oleh arsip." }, { status: 409 });
    }

    await db.kategori.delete({ where: { id } });
    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "hapus",
      objek: "kategori",
      detail: `${existing.kode} - ${existing.nama}`,
    });

    return NextResponse.json({
      message: "Kategori berhasil dihapus.",
      data: { id: existing.id, kode: existing.kode, nama: existing.nama },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return NextResponse.json({ message: "Kategori tidak dapat dihapus karena masih digunakan oleh arsip." }, { status: 409 });
      }
      if (error.code === "P2025") {
        return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 404 });
      }
    }
    console.error("DELETE Kategori:", error);
    return NextResponse.json({ message: "Gagal menghapus kategori." }, { status: 500 });
  }
}
