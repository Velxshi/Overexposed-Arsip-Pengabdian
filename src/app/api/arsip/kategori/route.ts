import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildKategoriWhere, isKategoriKodeTaken, KATEGORI_LIST_SELECT, KATEGORI_PUBLIC_SELECT, parseCreateKategoriPayload, parseKategoriJsonBody, requireKategoriManager, requireKategoriViewer } from "@/lib/kategori";
import { catatLog } from "@/lib/log-aktivitas";

const KATEGORI_PAGE_SIZE = 6;

export async function GET(request: NextRequest) {
  const auth = await requireKategoriViewer();
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const whereResult = buildKategoriWhere(params);
    if (!whereResult.ok) {
      return NextResponse.json({ message: whereResult.message }, { status: 400 });
    }

    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

    const [rawItems, matchedTotal] = await Promise.all([
      db.kategori.findMany({
        where: whereResult.where,
        orderBy: { kode: "asc" },
        skip: (page - 1) * KATEGORI_PAGE_SIZE,
        take: KATEGORI_PAGE_SIZE,
        select: KATEGORI_LIST_SELECT,
      }),
      db.kategori.count({ where: whereResult.where }),
    ]);

    const items = rawItems.map(({ _count, ...kategori }) => ({
      ...kategori,
      jumlah_arsip: _count.arsip,
    }));

    return NextResponse.json(
      {
        items,
        pagination: {
          page,
          pageSize: KATEGORI_PAGE_SIZE,
          total: matchedTotal,
          totalPages: Math.max(1, Math.ceil(matchedTotal / KATEGORI_PAGE_SIZE)),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET Kategori:", error);
    return NextResponse.json({ message: "Gagal mengambil kategori." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireKategoriManager();
  if (!auth.ok) return auth.response;

  const jsonBody = await parseKategoriJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;

  const parsed = parseCreateKategoriPayload(jsonBody.data);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  try {
    if (await isKategoriKodeTaken(parsed.data.kode)) {
      return NextResponse.json({ message: "Kode kategori sudah dipakai." }, { status: 409 });
    }

    const kategori = await db.kategori.create({
      data: parsed.data,
      select: KATEGORI_PUBLIC_SELECT,
    });

    await catatLog({
      userId: auth.session.sub,
      userNama: auth.session.name,
      modul: "4",
      aksi: "tambah",
      objek: "kategori",
      detail: `${kategori.kode} - ${kategori.nama}`,
    });

    return NextResponse.json({ message: "Kategori berhasil ditambahkan.", data: kategori }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "Kode kategori sudah dipakai." }, { status: 409 });
    }
    console.error("POST Kategori:", error);
    return NextResponse.json({ message: "Gagal menambah kategori." }, { status: 500 });
  }
}
