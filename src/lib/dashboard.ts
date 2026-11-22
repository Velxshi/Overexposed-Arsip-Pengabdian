import { Prisma } from "@/generated/prisma/client";
import { escapeLikePattern } from "@/lib/arsip";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;

export interface DashboardFilters {
  search: string;
  page: number;
  pageSize: number;
}

interface BarisAktivitas {
  id: number;
  nomor_arsip: string;
  nomor_surat: string;
  judul: string;
  kategori_kode: string;
  kategori_nama: string;
  tanggal_arsip: Date;
}

export function parseDashboardFilters(params: URLSearchParams): DashboardFilters {
  const search = (params.get("search") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const rawPageSize = Number.parseInt(params.get("pageSize") ?? params.get("limit") ?? "", 10);
  const pageSize = Number.isInteger(rawPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize))
    : DEFAULT_PAGE_SIZE;
  return { search, page, pageSize };
}

// Kolom date dari Postgres dibaca sebagai tengah malam UTC, jadi 10 karakter pertama ISO adalah tanggalnya.
export function formatTanggal(tanggal: Date): string {
  return tanggal.toISOString().slice(0, 10);
}

/**
 * Data Dashboard (PRD 6.3): jumlah arsip berstatus retensi Aktif dan aktivitas terbaru.
 * Status retensi dibaca dari v_arsip agar sama dengan perhitungan di halaman lain.
 * Pencarian hanya memengaruhi aktivitasTerbaru, bukan totalArsip.
 */
export async function getDashboardArsip(filters: DashboardFilters) {
  let whereSql = Prisma.empty;
  if (filters.search) {
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    whereSql = Prisma.sql`WHERE ("judul" ILIKE ${pattern} ESCAPE '\\' OR "nomor_surat" ILIKE ${pattern} ESCAPE '\\' OR "nomor_arsip" ILIKE ${pattern} ESCAPE '\\')`;
  }

  const offset = (filters.page - 1) * filters.pageSize;

  const [aktifRows, rows, countRows] = await Promise.all([
    db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS "total"
      FROM "v_arsip"
      WHERE "status" = 'Aktif'
    `,
    db.$queryRaw<BarisAktivitas[]>`
      SELECT
        "id",
        "nomor_arsip",
        "nomor_surat",
        "judul",
        "kategori_kode",
        "kategori_nama",
        "tanggal_arsip"
      FROM "v_arsip"
      ${whereSql}
      ORDER BY "created_at" DESC, "id" DESC
      LIMIT ${filters.pageSize}
      OFFSET ${offset}
    `,
    db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS "total"
      FROM "v_arsip"
      ${whereSql}
    `,
  ]);

  const total = countRows[0]?.total ?? 0;

  return {
    totalArsip: aktifRows[0]?.total ?? 0,
    aktivitasTerbaru: {
      items: rows.map((row) => ({
        id: row.id,
        nomor_arsip: row.nomor_arsip,
        judul: row.judul,
        kategori: { kode: row.kategori_kode, nama: row.kategori_nama },
        nomor_surat: row.nomor_surat,
        tanggal_arsip: formatTanggal(row.tanggal_arsip),
      })),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      },
    },
  };
}
