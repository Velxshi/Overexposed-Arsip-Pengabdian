import { NextRequest, NextResponse } from "next/server";
import { Prisma, type StatusValidasi } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { KATEGORI_INT_MAX, KATEGORI_SMALLINT_MAX, parseKategoriIdParam, parseKategoriJsonBody, parseKategoriSmallInt } from "@/lib/kategori";
import { getArsipPermissions } from "@/lib/rbac";
import { hitungRetensi, type HasilRetensi } from "@/lib/retensi";
import { getSession, type LocalSessionPayload } from "@/lib/session";

const DEFAULT_ARSIP_PAGE_SIZE = 10;
const MAX_ARSIP_PAGE_SIZE = 50;
const DATE_PREFIX_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

export const ARSIP_DETAIL_SELECT = {
  id: true,
  nomor_arsip: true,
  nomor_surat: true,
  judul: true,
  kategori_id: true,
  tanggal_arsip: true,
  pencipta_unit: true,
  retensi_aktif_tahun: true,
  retensi_inaktif_tahun: true,
  link_berkas: true,
  keterangan: true,
  status_validasi: true,
  catatan_validasi: true,
  dibuat_oleh: true,
  created_at: true,
  updated_at: true,
  kategori: {
    select: {
      id: true,
      kode: true,
      nama: true,
    },
  },
} as const;

type ArsipAuthResult = { ok: true; session: LocalSessionPayload } | { ok: false; response: NextResponse };

async function requireArsipAccess(permissionKey: "canViewArsip" | "canManageArsip" | "canValidate", forbiddenMessage: string): Promise<ArsipAuthResult> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ message: "Silakan login terlebih dahulu." }, { status: 401 }),
    };
  }

  const permissions = getArsipPermissions(session);
  if (!permissions[permissionKey]) {
    return {
      ok: false,
      response: NextResponse.json({ message: forbiddenMessage }, { status: 403 }),
    };
  }

  return { ok: true, session };
}

export function requireArsipViewer(): Promise<ArsipAuthResult> {
  return requireArsipAccess("canViewArsip", "Anda tidak memiliki izin untuk melihat arsip.");
}

export function requireArsipManager(): Promise<ArsipAuthResult> {
  return requireArsipAccess("canManageArsip", "Anda tidak memiliki izin untuk mengelola arsip.");
}

export function requireArsipValidator(): Promise<ArsipAuthResult> {
  return requireArsipAccess("canValidate", "Anda tidak memiliki izin untuk memvalidasi arsip.");
}

export function parseArsipIdParam(rawId: string): number | null {
  return parseKategoriIdParam(rawId);
}

export function parseArsipJsonBody(request: NextRequest): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  return parseKategoriJsonBody(request);
}

export interface ArsipListFilters {
  search: string;
  kategoriId?: number;
  kategoriKode?: string;
  tahun?: number;
  page: number;
  pageSize: number;
}

function parseOptionalPositiveInt(raw: string | null, label: string, max = KATEGORI_INT_MAX): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (raw === null) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `Parameter ${label} tidak valid.` };
  }
  const value = Number.parseInt(trimmed, 10);
  if (value < 1 || value > max) {
    return { ok: false, message: `Parameter ${label} tidak valid.` };
  }
  return { ok: true, value };
}

export function parseArsipListFilters(params: URLSearchParams): { ok: true; filters: ArsipListFilters } | { ok: false; message: string } {
  const search = (params.get("search") ?? "").trim().slice(0, 100);

  let kategoriId: number | undefined;
  let kategoriKode: string | undefined;

  const rawKategoriId = params.get("kategoriId") ?? params.get("kategori_id");
  if (rawKategoriId !== null && rawKategoriId.trim() !== "") {
    const parsedKategori = parseOptionalPositiveInt(rawKategoriId, "kategoriId");
    if (!parsedKategori.ok) return parsedKategori;
    kategoriId = parsedKategori.value;
  } else {
    const rawKategori = (params.get("kategori") ?? "").trim();
    if (rawKategori) {
      if (/^\d+$/.test(rawKategori)) {
        const parsedKategori = parseOptionalPositiveInt(rawKategori, "kategori");
        if (!parsedKategori.ok) return parsedKategori;
        kategoriId = parsedKategori.value;
      } else {
        kategoriKode = rawKategori.toUpperCase();
      }
    }
  }

  const tahunParsed = parseOptionalPositiveInt(params.get("tahun"), "tahun", 9999);
  if (!tahunParsed.ok) return tahunParsed;

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const rawPageSize = Number.parseInt(params.get("pageSize") ?? params.get("limit") ?? String(DEFAULT_ARSIP_PAGE_SIZE), 10);
  const pageSize = Number.isInteger(rawPageSize) ? Math.min(MAX_ARSIP_PAGE_SIZE, Math.max(1, rawPageSize)) : DEFAULT_ARSIP_PAGE_SIZE;

  return {
    ok: true,
    filters: {
      search,
      kategoriId,
      kategoriKode,
      tahun: tahunParsed.value,
      page,
      pageSize,
    },
  };
}

export function buildArsipWhere(params: URLSearchParams): { ok: true; where: Prisma.ArsipWhereInput } | { ok: false; message: string } {
  const parsed = parseArsipListFilters(params);
  if (!parsed.ok) return parsed;

  const { filters } = parsed;
  const andConditions: Prisma.ArsipWhereInput[] = [];

  if (filters.search) {
    andConditions.push({
      OR: [{ judul: { contains: filters.search, mode: "insensitive" } }, { nomor_surat: { contains: filters.search, mode: "insensitive" } }, { nomor_arsip: { contains: filters.search, mode: "insensitive" } }],
    });
  }

  if (filters.kategoriId !== undefined) {
    andConditions.push({ kategori_id: filters.kategoriId });
  } else if (filters.kategoriKode) {
    andConditions.push({
      kategori: {
        kode: { equals: filters.kategoriKode, mode: "insensitive" },
      },
    });
  }

  if (filters.tahun !== undefined) {
    andConditions.push({
      tanggal_arsip: {
        gte: new Date(Date.UTC(filters.tahun, 0, 1)),
        lt: new Date(Date.UTC(filters.tahun + 1, 0, 1)),
      },
    });
  }

  return {
    ok: true,
    where: andConditions.length > 0 ? { AND: andConditions } : {},
  };
}

interface VArsipListRow {
  id: number;
  nomor_arsip: string;
  nomor_surat: string;
  judul: string;
  kategori_id: number;
  kategori_kode: string;
  kategori_nama: string;
  tanggal_arsip: Date;
  retensi_aktif_tahun: number;
  retensi_inaktif_tahun: number;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Daftar arsip dari PostgreSQL view v_arsip sesuai PRD 6.3 & issue.
 * Sengaja TIDAK memilih atau mengembalikan status retensi, status validasi, maupun catatan validasi.
 */
export async function listArsipFromView(filters: ArsipListFilters) {
  const conditions: Prisma.Sql[] = [];

  if (filters.search) {
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(Prisma.sql`("judul" ILIKE ${pattern} ESCAPE '\\' OR "nomor_surat" ILIKE ${pattern} ESCAPE '\\' OR "nomor_arsip" ILIKE ${pattern} ESCAPE '\\')`);
  }

  if (filters.kategoriId !== undefined) {
    conditions.push(Prisma.sql`"kategori_id" = ${filters.kategoriId}`);
  } else if (filters.kategoriKode) {
    conditions.push(Prisma.sql`UPPER("kategori_kode") = ${filters.kategoriKode}`);
  }

  if (filters.tahun !== undefined) {
    const startDate = new Date(Date.UTC(filters.tahun, 0, 1));
    const endDate = new Date(Date.UTC(filters.tahun + 1, 0, 1));
    conditions.push(Prisma.sql`("tanggal_arsip" >= ${startDate}::date AND "tanggal_arsip" < ${endDate}::date)`);
  }

  const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const offset = (filters.page - 1) * filters.pageSize;

  const [rows, countRows] = await Promise.all([
    db.$queryRaw<VArsipListRow[]>`
      SELECT
        "id",
        "nomor_arsip",
        "nomor_surat",
        "judul",
        "kategori_id",
        "kategori_kode",
        "kategori_nama",
        "tanggal_arsip",
        "retensi_aktif_tahun",
        "retensi_inaktif_tahun"
      FROM "v_arsip"
      ${whereSql}
      ORDER BY "tanggal_arsip" DESC, "id" DESC
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
    items: rows.map((row) => ({
      id: row.id,
      nomor_arsip: row.nomor_arsip,
      nomor_surat: row.nomor_surat,
      judul: row.judul,
      tanggal_arsip: row.tanggal_arsip,
      kategori_id: row.kategori_id,
      kategori: {
        kode: row.kategori_kode,
        nama: row.kategori_nama,
      },
      retensi_aktif_tahun: row.retensi_aktif_tahun,
      retensi_inaktif_tahun: row.retensi_inaktif_tahun,
    })),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
  };
}

export interface ParsedArsipPayload {
  nomor_arsip: string;
  nomor_surat: string;
  judul: string;
  kategori_id: number;
  tanggal_arsip: Date;
  link_berkas: string;
  keterangan: string | null;
  retensi_aktif_tahun?: number;
  retensi_inaktif_tahun?: number;
}

function parseRequiredText(raw: unknown, label: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { ok: false, message: `${label} harus diisi.` };
  }
  return { ok: true, value };
}

function parseOptionalText(raw: unknown, label: string): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, message: `${label} harus berupa teks.` };
  }
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return { ok: true, value: trimmed || null };
}

function parseLinkBerkas(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return { ok: false, message: "Link berkas harus diisi." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { ok: false, message: "Link berkas harus berupa URL yang valid (contoh: https://...)." };
  }

  const isHttp = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  const hasValidHost = parsedUrl.hostname === "localhost" || parsedUrl.hostname.includes(".");
  if (!isHttp || !hasValidHost) {
    return { ok: false, message: "Link berkas harus berupa URL http:// atau https:// yang valid." };
  }

  return { ok: true, value: trimmed };
}

function parseRequiredPositiveId(raw: unknown, label: string): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1 || raw > KATEGORI_INT_MAX) {
      return { ok: false, message: `${label} tidak valid.` };
    }
    return { ok: true, value: raw };
  }
  if (typeof raw === "string") {
    const parsed = parseKategoriIdParam(raw.trim());
    if (parsed !== null) return { ok: true, value: parsed };
  }
  return { ok: false, message: `${label} wajib dipilih.` };
}

function parseTanggalArsip(raw: unknown): { ok: true; value: Date } | { ok: false; message: string } {
  if (typeof raw !== "string") {
    return { ok: false, message: "Tanggal arsip wajib diisi (format YYYY-MM-DD)." };
  }
  const trimmed = raw.trim();
  const match = DATE_PREFIX_REGEX.exec(trimmed);
  if (!match) {
    return { ok: false, message: "Tanggal arsip harus berformat YYYY-MM-DD." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, message: "Tanggal arsip tidak valid." };
  }

  return { ok: true, value: date };
}

export function parseArsipPayload(rawBody: unknown): { ok: true; data: ParsedArsipPayload } | { ok: false; message: string } {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, message: "Body request tidak valid." };
  }

  const body = rawBody as Record<string, unknown>;

  const nomorArsip = parseRequiredText(body.nomorArsip ?? body.nomor_arsip, "Nomor arsip");
  if (!nomorArsip.ok) return nomorArsip;

  const nomorSurat = parseRequiredText(body.nomorSurat ?? body.nomor_surat, "Nomor surat");
  if (!nomorSurat.ok) return nomorSurat;

  const judul = parseRequiredText(body.judul, "Judul arsip");
  if (!judul.ok) return judul;

  const kategoriId = parseRequiredPositiveId(body.kategoriId ?? body.kategori_id, "Kategori");
  if (!kategoriId.ok) return kategoriId;

  const tanggalArsip = parseTanggalArsip(body.tanggalArsip ?? body.tanggal_arsip);
  if (!tanggalArsip.ok) return tanggalArsip;

  const linkBerkas = parseLinkBerkas(body.linkBerkas ?? body.link_berkas);
  if (!linkBerkas.ok) return linkBerkas;

  // pencipta_unit sengaja tidak dibaca dari body: diisi nama akun yang login di route handler.
  const keterangan = parseOptionalText(body.keterangan, "Keterangan");
  if (!keterangan.ok) return keterangan;

  const aktifParsed = parseKategoriSmallInt(body.retensiAktifTahun ?? body.retensi_aktif_tahun);
  if (!aktifParsed.ok) {
    return {
      ok: false,
      message: `Retensi aktif (tahun) harus bilangan bulat 0-${KATEGORI_SMALLINT_MAX}.`,
    };
  }

  const inaktifParsed = parseKategoriSmallInt(body.retensiInaktifTahun ?? body.retensi_inaktif_tahun);
  if (!inaktifParsed.ok) {
    return {
      ok: false,
      message: `Retensi inaktif (tahun) harus bilangan bulat 0-${KATEGORI_SMALLINT_MAX}.`,
    };
  }

  return {
    ok: true,
    data: {
      nomor_arsip: nomorArsip.value,
      nomor_surat: nomorSurat.value,
      judul: judul.value,
      kategori_id: kategoriId.value,
      tanggal_arsip: tanggalArsip.value,
      link_berkas: linkBerkas.value,
      keterangan: keterangan.value,
      ...(aktifParsed.value !== undefined ? { retensi_aktif_tahun: aktifParsed.value } : {}),
      ...(inaktifParsed.value !== undefined ? { retensi_inaktif_tahun: inaktifParsed.value } : {}),
    },
  };
}

export type PatchArsipData = Partial<Omit<ParsedArsipPayload, "retensi_aktif_tahun" | "retensi_inaktif_tahun">> & {
  retensi_aktif_tahun?: number;
  retensi_inaktif_tahun?: number;
};

export function parsePatchArsipPayload(rawBody: unknown): { ok: true; data: PatchArsipData } | { ok: false; message: string } {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, message: "Body request tidak valid." };
  }

  const body = rawBody as Record<string, unknown>;
  const data: PatchArsipData = {};

  if ("nomorArsip" in body || "nomor_arsip" in body) {
    const res = parseRequiredText(body.nomorArsip ?? body.nomor_arsip, "Nomor arsip");
    if (!res.ok) return res;
    data.nomor_arsip = res.value;
  }

  if ("nomorSurat" in body || "nomor_surat" in body) {
    const res = parseRequiredText(body.nomorSurat ?? body.nomor_surat, "Nomor surat");
    if (!res.ok) return res;
    data.nomor_surat = res.value;
  }

  if ("judul" in body) {
    const res = parseRequiredText(body.judul, "Judul arsip");
    if (!res.ok) return res;
    data.judul = res.value;
  }

  if ("kategoriId" in body || "kategori_id" in body) {
    const res = parseRequiredPositiveId(body.kategoriId ?? body.kategori_id, "Kategori");
    if (!res.ok) return res;
    data.kategori_id = res.value;
  }

  if ("tanggalArsip" in body || "tanggal_arsip" in body) {
    const res = parseTanggalArsip(body.tanggalArsip ?? body.tanggal_arsip);
    if (!res.ok) return res;
    data.tanggal_arsip = res.value;
  }

  if ("linkBerkas" in body || "link_berkas" in body) {
    const res = parseLinkBerkas(body.linkBerkas ?? body.link_berkas);
    if (!res.ok) return res;
    data.link_berkas = res.value;
  }

  // pencipta_unit tidak bisa diubah: tetap nama pembuat arsip.
  if ("keterangan" in body) {
    const res = parseOptionalText(body.keterangan, "Keterangan");
    if (!res.ok) return res;
    data.keterangan = res.value;
  }

  if ("retensiAktifTahun" in body || "retensi_aktif_tahun" in body) {
    const parsed = parseKategoriSmallInt(body.retensiAktifTahun ?? body.retensi_aktif_tahun);
    if (!parsed.ok || parsed.value === undefined) {
      return {
        ok: false,
        message: `Retensi aktif (tahun) wajib diisi bilangan bulat 0-${KATEGORI_SMALLINT_MAX}.`,
      };
    }
    data.retensi_aktif_tahun = parsed.value;
  }

  if ("retensiInaktifTahun" in body || "retensi_inaktif_tahun" in body) {
    const parsed = parseKategoriSmallInt(body.retensiInaktifTahun ?? body.retensi_inaktif_tahun);
    if (!parsed.ok || parsed.value === undefined) {
      return {
        ok: false,
        message: `Retensi inaktif (tahun) wajib diisi bilangan bulat 0-${KATEGORI_SMALLINT_MAX}.`,
      };
    }
    data.retensi_inaktif_tahun = parsed.value;
  }

  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      message: "Minimal satu field arsip harus diisi untuk diperbarui.",
    };
  }

  return { ok: true, data };
}

export async function findKategoriForArsip(kategoriId: number) {
  return db.kategori.findUnique({
    where: { id: kategoriId },
    select: {
      id: true,
      retensi_aktif_tahun: true,
      retensi_inaktif_tahun: true,
    },
  });
}

/**
 * Menyalin masa retensi dari kategori saat field opsional tidak diisi.
 */
export function resolveArsipRetention(payload: Pick<ParsedArsipPayload, "retensi_aktif_tahun" | "retensi_inaktif_tahun">, kategoriDefaults: { retensi_aktif_tahun: number; retensi_inaktif_tahun: number }) {
  return {
    retensi_aktif_tahun: payload.retensi_aktif_tahun ?? kategoriDefaults.retensi_aktif_tahun,
    retensi_inaktif_tahun: payload.retensi_inaktif_tahun ?? kategoriDefaults.retensi_inaktif_tahun,
  };
}

export async function isNomorArsipTaken(nomorArsip: string, excludeId?: number): Promise<boolean> {
  const duplicate = await db.arsip.findFirst({
    where: {
      nomor_arsip: nomorArsip,
      ...(excludeId !== undefined ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  return duplicate !== null;
}

export function formatArsipDetail<
  T extends {
    tanggal_arsip: Date;
    retensi_aktif_tahun: number;
    retensi_inaktif_tahun: number;
  },
>(
  arsip: T,
  sekarang: Date = new Date(),
): T & {
  status_retensi: HasilRetensi["status"];
  tanggal_habis_aktif: Date;
  tanggal_habis_inaktif: Date;
} {
  const retensi = hitungRetensi(arsip.tanggal_arsip, arsip.retensi_aktif_tahun, arsip.retensi_inaktif_tahun, sekarang);

  return {
    ...arsip,
    status_retensi: retensi.status,
    tanggal_habis_aktif: retensi.tanggalHabisAktif,
    tanggal_habis_inaktif: retensi.tanggalHabisInaktif,
  };
}

export function canDeleteArsip(
  arsip: {
    tanggal_arsip: Date;
    retensi_aktif_tahun: number;
    retensi_inaktif_tahun: number;
  },
  sekarang: Date = new Date(),
): { allowed: boolean; retensi: HasilRetensi } {
  const retensi = hitungRetensi(arsip.tanggal_arsip, arsip.retensi_aktif_tahun, arsip.retensi_inaktif_tahun, sekarang);
  return {
    allowed: retensi.status === "Dimusnahkan",
    retensi,
  };
}

export type KeputusanValidasiArsip = Extract<StatusValidasi, "Diterima" | "Ditolak">;

export interface ParsedValidasiArsipPayload {
  status_validasi: KeputusanValidasiArsip;
  catatan_validasi: string | null;
}

export interface ArsipValidasiListFilters extends ArsipListFilters {
  status?: StatusValidasi;
}

function normalizeStatusValidasi(raw: string): StatusValidasi | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "pending") return "Pending";
  if (lower === "diterima") return "Diterima";
  if (lower === "ditolak") return "Ditolak";
  return null;
}

export function parseValidasiArsipPayload(rawBody: unknown): { ok: true; data: ParsedValidasiArsipPayload } | { ok: false; message: string } {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, message: "Body request tidak valid." };
  }

  const body = rawBody as Record<string, unknown>;
  const rawStatus = body.status_validasi ?? body.statusValidasi ?? body.status;
  const normalizedStatus = typeof rawStatus === "string" ? normalizeStatusValidasi(rawStatus) : null;

  if (normalizedStatus !== "Diterima" && normalizedStatus !== "Ditolak") {
    return {
      ok: false,
      message: "Status validasi harus diisi dengan Diterima atau Ditolak.",
    };
  }

  const rawCatatan = body.catatan_validasi ?? body.catatanValidasi ?? body.catatan;
  const catatanParsed = parseOptionalText(rawCatatan, "Catatan validasi");
  if (!catatanParsed.ok) return catatanParsed;

  if (normalizedStatus === "Ditolak" && !catatanParsed.value) {
    return {
      ok: false,
      message: "Catatan validasi wajib diisi saat arsip ditolak.",
    };
  }

  return {
    ok: true,
    data: {
      status_validasi: normalizedStatus,
      catatan_validasi: catatanParsed.value,
    },
  };
}

export function parseArsipValidasiFilters(
  params: URLSearchParams,
): { ok: true; filters: ArsipValidasiListFilters; where: Prisma.ArsipWhereInput } | { ok: false; message: string } {
  const baseFiltersResult = parseArsipListFilters(params);
  if (!baseFiltersResult.ok) return baseFiltersResult;

  const baseWhereResult = buildArsipWhere(params);
  if (!baseWhereResult.ok) return baseWhereResult;

  const rawStatus = params.get("status") ?? params.get("status_validasi") ?? params.get("statusValidasi");
  let status: StatusValidasi | undefined;

  if (rawStatus !== null && rawStatus.trim() !== "") {
    const normalized = normalizeStatusValidasi(rawStatus);
    if (!normalized) {
      return {
        ok: false,
        message: "Parameter status harus berupa Pending, Diterima, atau Ditolak.",
      };
    }
    status = normalized;
  }

  const where: Prisma.ArsipWhereInput =
    status !== undefined
      ? Object.keys(baseWhereResult.where).length > 0
        ? { AND: [baseWhereResult.where, { status_validasi: status }] }
        : { status_validasi: status }
      : baseWhereResult.where;

  return {
    ok: true,
    filters: {
      ...baseFiltersResult.filters,
      status,
    },
    where,
  };
}
