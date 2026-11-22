import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getArsipPermissions } from "@/lib/rbac";
import { getSession, type LocalSessionPayload } from "@/lib/session";

export const KATEGORI_SMALLINT_MAX = 32767;
export const KATEGORI_INT_MAX = 2147483647;
export const KATEGORI_KODE_REGEX = /^[A-Z]{1,5}$/;

export const KATEGORI_PUBLIC_SELECT = {
  id: true,
  kode: true,
  nama: true,
  retensi_aktif_tahun: true,
  retensi_inaktif_tahun: true,
  keterangan: true,
  created_at: true,
  updated_at: true,
} as const;

export const KATEGORI_LIST_SELECT = {
  id: true,
  kode: true,
  nama: true,
  retensi_aktif_tahun: true,
  retensi_inaktif_tahun: true,
  keterangan: true,
  _count: {
    select: { arsip: true },
  },
} as const;

type ParseSmallIntResult = { ok: true; value: number | undefined } | { ok: false };

export function parseKategoriSmallInt(raw: unknown): ParseSmallIntResult {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };

  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > KATEGORI_SMALLINT_MAX) {
      return { ok: false };
    }
    return { ok: true, value: raw };
  }

  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!/^\d+$/.test(trimmed)) return { ok: false };

  const value = Number.parseInt(trimmed, 10);
  if (value > KATEGORI_SMALLINT_MAX) return { ok: false };
  return { ok: true, value };
}

export function parseKategoriIdParam(rawId: string): number | null {
  if (!/^\d+$/.test(rawId)) return null;
  const parsed = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > KATEGORI_INT_MAX) {
    return null;
  }
  return parsed;
}

type KategoriAuthResult =
  | { ok: true; session: LocalSessionPayload }
  | { ok: false; response: NextResponse };

async function requireKategoriAccess(
  permissionKey: "canViewKategori" | "canManageKategori",
  forbiddenMessage: string,
): Promise<KategoriAuthResult> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Silakan login terlebih dahulu." },
        { status: 401 },
      ),
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

export function requireKategoriViewer(): Promise<KategoriAuthResult> {
  return requireKategoriAccess(
    "canViewKategori",
    "Anda tidak memiliki izin untuk mengakses kategori arsip.",
  );
}

export function requireKategoriManager(): Promise<KategoriAuthResult> {
  return requireKategoriAccess(
    "canManageKategori",
    "Anda tidak memiliki izin untuk mengelola kategori arsip.",
  );
}

export async function parseKategoriJsonBody(
  request: NextRequest,
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Body request harus berupa JSON yang valid." },
        { status: 400 },
      ),
    };
  }
}

export function buildKategoriWhere(
  params: URLSearchParams,
): { ok: true; where: Prisma.KategoriWhereInput } | { ok: false; message: string } {
  const andConditions: Prisma.KategoriWhereInput[] = [];

  const search = (params.get("search") ?? "").trim().slice(0, 100);
  if (search) {
    andConditions.push({
      OR: [
        { kode: { contains: search, mode: "insensitive" } },
        { nama: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  const retentionFilters = [
    { field: "retensi_aktif_tahun", keys: ["retensi_aktif_tahun", "retensi_aktif"] },
    { field: "retensi_inaktif_tahun", keys: ["retensi_inaktif_tahun", "retensi_inaktif"] },
  ] as const;

  for (const { field, keys } of retentionFilters) {
    const raw = params.get(keys[0]) ?? params.get(keys[1]);
    const parsed = parseKategoriSmallInt(raw);
    if (!parsed.ok) {
      return { ok: false, message: `Parameter ${field} tidak valid.` };
    }
    if (parsed.value !== undefined) {
      andConditions.push({ [field]: parsed.value });
    }
  }

  const rawRetensi = (params.get("retensi") ?? params.get("masa_retensi") ?? "").trim();
  if (rawRetensi) {
    if (rawRetensi.includes("/")) {
      const parts = rawRetensi.split("/");
      const aktifPart =
        parts.length === 2 ? parseKategoriSmallInt(parts[0]) : { ok: false as const };
      const inaktifPart =
        parts.length === 2 ? parseKategoriSmallInt(parts[1]) : { ok: false as const };
      if (
        !aktifPart.ok ||
        !inaktifPart.ok ||
        aktifPart.value === undefined ||
        inaktifPart.value === undefined
      ) {
        return {
          ok: false,
          message: "Parameter retensi harus berupa angka atau format aktif/inaktif.",
        };
      }
      andConditions.push({
        retensi_aktif_tahun: aktifPart.value,
        retensi_inaktif_tahun: inaktifPart.value,
      });
    } else {
      const single = parseKategoriSmallInt(rawRetensi);
      if (!single.ok || single.value === undefined) {
        return { ok: false, message: "Parameter retensi tidak valid." };
      }
      andConditions.push({
        OR: [
          { retensi_aktif_tahun: single.value },
          { retensi_inaktif_tahun: single.value },
        ],
      });
    }
  }

  return {
    ok: true,
    where: andConditions.length > 0 ? { AND: andConditions } : {},
  };
}

export async function isKategoriKodeTaken(
  kode: string,
  excludeId?: number,
): Promise<boolean> {
  const duplicate = await db.kategori.findFirst({
    where: {
      kode: { equals: kode, mode: "insensitive" },
      ...(excludeId !== undefined ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  return duplicate !== null;
}

export interface KategoriWriteData {
  kode: string;
  nama: string;
  retensi_aktif_tahun: number;
  retensi_inaktif_tahun: number;
  keterangan: string | null;
}

function parseKodeValue(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const kode = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!kode) {
    return { ok: false, message: "Kode kategori harus diisi." };
  }
  if (!KATEGORI_KODE_REGEX.test(kode)) {
    return { ok: false, message: "Kode kategori maksimal 5 huruf kapital (A-Z)." };
  }
  return { ok: true, value: kode };
}

function parseNamaValue(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const nama = typeof raw === "string" ? raw.trim() : "";
  if (!nama) {
    return { ok: false, message: "Nama kategori harus diisi." };
  }
  return { ok: true, value: nama };
}

function parseKeteranganValue(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, message: "Keterangan harus berupa teks." };
  }
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return { ok: true, value: trimmed || null };
}

function parseRequiredRetentionYear(
  raw: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = parseKategoriSmallInt(raw);
  if (!parsed.ok || parsed.value === undefined || parsed.value < 1) {
    return {
      ok: false,
      message: `${label} wajib diisi bilangan bulat minimal 1 (1-${KATEGORI_SMALLINT_MAX}).`,
    };
  }
  return { ok: true, value: parsed.value };
}

export function parseCreateKategoriPayload(
  rawBody: unknown,
): { ok: true; data: KategoriWriteData } | { ok: false; message: string } {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, message: "Body request tidak valid." };
  }

  const body = rawBody as Record<string, unknown>;
  const kodeResult = parseKodeValue(body.kode);
  if (!kodeResult.ok) return kodeResult;

  const namaResult = parseNamaValue(body.nama);
  if (!namaResult.ok) return namaResult;

  const keteranganResult = parseKeteranganValue(body.keterangan);
  if (!keteranganResult.ok) return keteranganResult;

  const aktifResult = parseRequiredRetentionYear(
    body.retensiAktifTahun ?? body.retensi_aktif_tahun,
    "Retensi aktif (tahun)",
  );
  if (!aktifResult.ok) return aktifResult;

  const inaktifResult = parseRequiredRetentionYear(
    body.retensiInaktifTahun ?? body.retensi_inaktif_tahun,
    "Retensi inaktif (tahun)",
  );
  if (!inaktifResult.ok) return inaktifResult;

  return {
    ok: true,
    data: {
      kode: kodeResult.value,
      nama: namaResult.value,
      retensi_aktif_tahun: aktifResult.value,
      retensi_inaktif_tahun: inaktifResult.value,
      keterangan: keteranganResult.value,
    },
  };
}

export function parsePatchKategoriPayload(
  rawBody: unknown,
): { ok: true; data: Partial<KategoriWriteData> } | { ok: false; message: string } {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, message: "Body request tidak valid." };
  }

  const body = rawBody as Record<string, unknown>;
  const data: Partial<KategoriWriteData> = {};

  if ("kode" in body) {
    const res = parseKodeValue(body.kode);
    if (!res.ok) return res;
    data.kode = res.value;
  }

  if ("nama" in body) {
    const res = parseNamaValue(body.nama);
    if (!res.ok) return res;
    data.nama = res.value;
  }

  if ("keterangan" in body) {
    const res = parseKeteranganValue(body.keterangan);
    if (!res.ok) return res;
    data.keterangan = res.value;
  }

  if ("retensiAktifTahun" in body || "retensi_aktif_tahun" in body) {
    const res = parseRequiredRetentionYear(
      body.retensiAktifTahun ?? body.retensi_aktif_tahun,
      "Retensi aktif (tahun)",
    );
    if (!res.ok) return res;
    data.retensi_aktif_tahun = res.value;
  }

  if ("retensiInaktifTahun" in body || "retensi_inaktif_tahun" in body) {
    const res = parseRequiredRetentionYear(
      body.retensiInaktifTahun ?? body.retensi_inaktif_tahun,
      "Retensi inaktif (tahun)",
    );
    if (!res.ok) return res;
    data.retensi_inaktif_tahun = res.value;
  }

  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      message: "Minimal satu field kategori harus diisi untuk diperbarui.",
    };
  }

  return { ok: true, data };
}
