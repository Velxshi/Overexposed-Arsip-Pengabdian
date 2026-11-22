import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AksiLog, ModulLog, ObjekLog } from "@/lib/log-aktivitas";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const MODUL: readonly ModulLog[] = ["4", "7", "auth"];
const AKSI: readonly AksiLog[] = ["tambah", "ubah", "hapus", "validasi", "sinkron", "login", "login_gagal"];
const OBJEK: readonly ObjekLog[] = ["arsip", "kategori", "dosen", "sso"];

// Log dibaca orang di Indonesia, jadi batas hari pada filter tanggal memakai WIB (UTC+7, tanpa DST).
const OFFSET_WIB = "+07:00";
const FORMAT_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface LogAktivitasFilters {
  modul?: ModulLog;
  aksi?: AksiLog;
  objek?: ObjekLog;
  dari?: Date;
  sebelum?: Date;
  page: number;
  pageSize: number;
}

type HasilParse = { ok: true; filters: LogAktivitasFilters } | { ok: false; message: string };

function pilihan<T extends string>(raw: string | null, daftar: readonly T[]): { ok: true; value?: T } | { ok: false } {
  const nilai = (raw ?? "").trim().toLowerCase();
  if (!nilai) return { ok: true };
  const cocok = daftar.find((item) => item === nilai);
  return cocok ? { ok: true, value: cocok } : { ok: false };
}

// Mengembalikan awal hari (00.00 WIB) untuk tanggal YYYY-MM-DD, atau null bila tanggal tidak ada di kalender.
function awalHariWib(raw: string): Date | null {
  const cocok = FORMAT_TANGGAL.exec(raw);
  if (!cocok) return null;
  const [, t, b, h] = cocok.map(Number);
  const cek = new Date(Date.UTC(t, b - 1, h));
  if (cek.getUTCFullYear() !== t || cek.getUTCMonth() !== b - 1 || cek.getUTCDate() !== h) return null;
  return new Date(`${raw}T00:00:00${OFFSET_WIB}`);
}

export function parseLogAktivitasFilters(params: URLSearchParams): HasilParse {
  const modul = pilihan(params.get("modul"), MODUL);
  if (!modul.ok) return { ok: false, message: "Parameter modul harus 4, 7, atau auth." };

  const aksi = pilihan(params.get("aksi"), AKSI);
  if (!aksi.ok) return { ok: false, message: `Parameter aksi harus salah satu dari: ${AKSI.join(", ")}.` };

  const objek = pilihan(params.get("objek"), OBJEK);
  if (!objek.ok) return { ok: false, message: `Parameter objek harus salah satu dari: ${OBJEK.join(", ")}.` };

  let dari: Date | undefined;
  const rawDari = (params.get("dari") ?? "").trim();
  if (rawDari) {
    const tanggal = awalHariWib(rawDari);
    if (!tanggal) return { ok: false, message: "Parameter dari harus tanggal valid berformat YYYY-MM-DD." };
    dari = tanggal;
  }

  // "sampai" bersifat inklusif: seluruh hari itu ikut, jadi batasnya awal hari berikutnya.
  let sebelum: Date | undefined;
  const rawSampai = (params.get("sampai") ?? "").trim();
  if (rawSampai) {
    const tanggal = awalHariWib(rawSampai);
    if (!tanggal) return { ok: false, message: "Parameter sampai harus tanggal valid berformat YYYY-MM-DD." };
    sebelum = new Date(tanggal.getTime() + 24 * 60 * 60 * 1000);
  }

  if (dari && sebelum && dari >= sebelum) {
    return { ok: false, message: "Tanggal dari tidak boleh setelah tanggal sampai." };
  }

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const rawPageSize = Number.parseInt(params.get("pageSize") ?? params.get("limit") ?? "", 10);
  const pageSize = Number.isInteger(rawPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize))
    : DEFAULT_PAGE_SIZE;

  return {
    ok: true,
    filters: { modul: modul.value, aksi: aksi.value, objek: objek.value, dari, sebelum, page, pageSize },
  };
}

export function buildLogAktivitasWhere(filters: LogAktivitasFilters): Prisma.LogAktivitasWhereInput {
  const where: Prisma.LogAktivitasWhereInput = {};
  if (filters.modul) where.modul = filters.modul;
  if (filters.aksi) where.aksi = filters.aksi;
  if (filters.objek) where.objek = filters.objek;
  if (filters.dari || filters.sebelum) {
    where.created_at = {
      ...(filters.dari ? { gte: filters.dari } : {}),
      ...(filters.sebelum ? { lt: filters.sebelum } : {}),
    };
  }
  return where;
}

export async function listLogAktivitas(filters: LogAktivitasFilters) {
  const where = buildLogAktivitasWhere(filters);

  const [items, total] = await Promise.all([
    db.logAktivitas.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        user_id: true,
        user_nama: true,
        modul: true,
        aksi: true,
        objek: true,
        detail: true,
        created_at: true,
      },
    }),
    db.logAktivitas.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
  };
}
