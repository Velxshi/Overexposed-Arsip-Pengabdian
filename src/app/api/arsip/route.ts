import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ARSIP_DETAIL_SELECT, findKategoriForArsip, isNomorArsipTaken, listArsipFromView, parseArsipJsonBody, parseArsipListFilters, parseArsipPayload, requireArsipManager, requireArsipViewer, resolveArsipRetention } from "@/lib/arsip";
import { catatLog } from "@/lib/log-aktivitas";

export async function GET(request: NextRequest) {
  const auth = await requireArsipViewer();
  if (!auth.ok) return auth.response;

  const filterResult = parseArsipListFilters(request.nextUrl.searchParams);
  if (!filterResult.ok) {
    return NextResponse.json({ message: filterResult.message }, { status: 400 });
  }

  try {
    const result = await listArsipFromView(filterResult.filters);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET Arsip:", error);
    return NextResponse.json({ message: "Gagal mengambil arsip." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireArsipManager();
  if (!auth.ok) return auth.response;

  const jsonBody = await parseArsipJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;

  const parsed = parseArsipPayload(jsonBody.data);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    const [kategori, duplicate] = await Promise.all([findKategoriForArsip(parsed.data.kategori_id), isNomorArsipTaken(parsed.data.nomor_arsip)]);

    if (!kategori) {
      return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 400 });
    }

    if (duplicate) {
      return NextResponse.json({ message: "Nomor arsip sudah dipakai." }, { status: 409 });
    }

    const retensi = resolveArsipRetention(parsed.data, kategori);

    const arsip = await db.arsip.create({
      data: {
        nomor_arsip: parsed.data.nomor_arsip,
        nomor_surat: parsed.data.nomor_surat,
        judul: parsed.data.judul,
        kategori_id: parsed.data.kategori_id,
        tanggal_arsip: parsed.data.tanggal_arsip,
        pencipta_unit: auth.session.name,
        retensi_aktif_tahun: retensi.retensi_aktif_tahun,
        retensi_inaktif_tahun: retensi.retensi_inaktif_tahun,
        link_berkas: parsed.data.link_berkas,
        keterangan: parsed.data.keterangan,
        status_validasi: "Pending",
        dibuat_oleh: auth.session.sub,
      },
      select: ARSIP_DETAIL_SELECT,
    });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "tambah",
      objek: "arsip",
      detail: `${arsip.nomor_arsip} - ${arsip.judul}`,
    });

    return NextResponse.json({ message: "Arsip berhasil ditambahkan.", data: arsip }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json({ message: "Nomor arsip sudah dipakai." }, { status: 409 });
      }
      if (error.code === "P2003") {
        return NextResponse.json({ message: "Kategori tidak ditemukan." }, { status: 400 });
      }
    }
    console.error("POST Arsip:", error);
    return NextResponse.json({ message: "Gagal menambah arsip." }, { status: 500 });
  }
}
