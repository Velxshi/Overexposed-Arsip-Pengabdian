import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ctx, jsonRequest, PERAN_NON_STAFF, PERAN_STAFF, sesi, USER_ID } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  catatLog: vi.fn(),
  db: {
    kategori: { findUnique: vi.fn() },
    arsip: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/log-aktivitas", () => ({ catatLog: mocks.catatLog }));

import { Prisma } from "@/generated/prisma/client";
import { DELETE, GET as GET_DETAIL, PATCH } from "@/app/api/arsip/[id]/route";
import { GET, POST } from "@/app/api/arsip/route";

const URL_ARSIP = "http://localhost/api/arsip";
const BODY_VALID = {
  nomor_arsip: "ARS-001",
  nomor_surat: "001/UN/2026",
  judul: "Rapat Prodi",
  kategori_id: 1,
  tanggal_arsip: "2026-03-10",
  link_berkas: "https://drive.google.com/file/abc",
  pencipta_unit: "Prodi RPL",
};
const KATEGORI = { id: 1, retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 };
const ARSIP_TERSIMPAN = {
  id: 7,
  nomor_arsip: "ARS-001",
  nomor_surat: "001/UN/2026",
  judul: "Rapat Prodi",
  kategori_id: 1,
  tanggal_arsip: new Date("2026-03-10T00:00:00Z"),
  pencipta_unit: "Prodi RPL",
  retensi_aktif_tahun: 2,
  retensi_inaktif_tahun: 3,
  link_berkas: "https://drive.google.com/file/abc",
  keterangan: null,
  status_validasi: "Pending",
  catatan_validasi: null,
  dibuat_oleh: USER_ID,
  created_at: new Date("2026-03-10T00:00:00Z"),
  updated_at: new Date("2026-03-10T00:00:00Z"),
  kategori: { id: 1, kode: "ADM", nama: "Arsip Administrasi" },
};

function galatPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError("galat uji", { code, clientVersion: "uji" });
}

async function baca(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(sesi("Staff Kaprodi"));
});

describe("GET /api/arsip (daftar)", () => {
  beforeEach(() => {
    mocks.db.$queryRaw.mockImplementation(async (strings: string[]) =>
      strings.join("").includes("COUNT(*)") ? [{ total: 0 }] : [],
    );
  });

  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new NextRequest(URL_ARSIP))).status).toBe(401);
  });

  it.each([
    ["Staff Kaprodi", 200],
    ["Admin", 200],
    ["Kaprodi", 200],
    ["Dosen", 200],
    ["Mahasiswa", 403],
    ["Umum", 403],
  ])("peran %s mendapat %i", async (peran, status) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await GET(new NextRequest(URL_ARSIP));
    expect(res.status).toBe(status);
    if (status === 403) expect(mocks.db.$queryRaw).not.toHaveBeenCalled();
  });

  it("mengembalikan item dan paginasi", async () => {
    const res = await GET(new NextRequest(URL_ARSIP));
    expect(await baca(res)).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    });
  });

  it("meneruskan pencarian, tahun, dan halaman ke query", async () => {
    await GET(new NextRequest(`${URL_ARSIP}?search=ARS-001&tahun=2025&page=2&pageSize=5`));
    const daftar = mocks.db.$queryRaw.mock.calls.find(
      (panggilan: unknown[]) => !(panggilan[0] as string[]).join("").includes("COUNT(*)"),
    ) as unknown[];
    const [, whereSql, limit, offset] = daftar as [unknown, { sql: string; values: unknown[] }, number, number];

    expect(whereSql.sql).toContain('"nomor_arsip" ILIKE');
    expect(whereSql.values).toContain("%ARS-001%");
    expect(whereSql.values).toContainEqual(new Date("2025-01-01T00:00:00Z"));
    expect({ limit, offset }).toEqual({ limit: 5, offset: 5 });
  });

  it("400 untuk tahun yang tidak valid", async () => {
    const res = await GET(new NextRequest(`${URL_ARSIP}?tahun=abc`));
    expect(res.status).toBe(400);
    expect(mocks.db.$queryRaw).not.toHaveBeenCalled();
  });

  it("500 bila database gagal", async () => {
    mocks.db.$queryRaw.mockRejectedValue(new Error("db mati"));
    expect((await GET(new NextRequest(URL_ARSIP))).status).toBe(500);
  });
});

describe("GET /api/arsip/[id] (detail)", () => {
  const detail = (id = "7") => GET_DETAIL(new NextRequest(`${URL_ARSIP}/${id}`), ctx(id));

  it.each([
    ["Dosen", 200],
    ["Kaprodi", 200],
    ["Staff Kaprodi", 200],
    ["Mahasiswa", 403],
  ])("peran %s mendapat %i", async (peran, status) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    mocks.db.arsip.findUnique.mockResolvedValue(ARSIP_TERSIMPAN);
    expect((await detail()).status).toBe(status);
  });

  it("menyertakan status validasi, catatan, dan status retensi", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue({
      ...ARSIP_TERSIMPAN,
      tanggal_arsip: new Date("2000-01-01T00:00:00Z"),
      status_validasi: "Ditolak",
      catatan_validasi: "Nomor surat salah",
    });

    const body = (await baca(await detail())) as { data: Record<string, unknown> };

    expect(body.data.status_validasi).toBe("Ditolak");
    expect(body.data.catatan_validasi).toBe("Nomor surat salah");
    expect(body.data.status_retensi).toBe("Dimusnahkan");
    expect(body.data.tanggal_habis_aktif).toBe("2002-01-01T00:00:00.000Z");
    expect(body.data.tanggal_habis_inaktif).toBe("2005-01-01T00:00:00.000Z");
  });

  it("404 bila arsip tidak ada", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(null);
    expect((await detail()).status).toBe(404);
  });

  it("400 untuk id yang tidak valid", async () => {
    expect((await detail("abc")).status).toBe(400);
  });
});

describe("POST /api/arsip", () => {
  const tambah = (body: unknown = BODY_VALID) => POST(jsonRequest(URL_ARSIP, "POST", body));

  beforeEach(() => {
    mocks.db.kategori.findUnique.mockResolvedValue(KATEGORI);
    mocks.db.arsip.findFirst.mockResolvedValue(null);
    mocks.db.arsip.create.mockResolvedValue(ARSIP_TERSIMPAN);
  });

  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await tambah()).status).toBe(401);
  });

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403 dan tidak ada yang tersimpan", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await tambah();

    expect(res.status).toBe(403);
    expect(mocks.db.arsip.create).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it.each(PERAN_STAFF)("peran %s boleh menambah arsip", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    expect((await tambah()).status).toBe(201);
  });

  it("menyalin retensi dari kategori, status Pending, dan mencatat pembuat", async () => {
    const res = await tambah();
    const data = mocks.db.arsip.create.mock.calls[0][0].data;

    expect(res.status).toBe(201);
    expect(data.retensi_aktif_tahun).toBe(2);
    expect(data.retensi_inaktif_tahun).toBe(3);
    expect(data.status_validasi).toBe("Pending");
    expect(data.dibuat_oleh).toBe(USER_ID);
    expect(data.tanggal_arsip).toEqual(new Date("2026-03-10T00:00:00Z"));
  });

  it("pencipta_unit diisi nama akun yang login, bukan nilai dari body", async () => {
    await tambah({ ...BODY_VALID, pencipta_unit: "Unit Palsu" });
    expect(mocks.db.arsip.create.mock.calls[0][0].data.pencipta_unit).toBe("Pengguna Uji");
  });

  it("pencipta_unit tetap terisi walau body tidak mengirimnya", async () => {
    const tanpaPencipta: Record<string, unknown> = { ...BODY_VALID };
    delete tanpaPencipta.pencipta_unit;
    await tambah(tanpaPencipta);
    expect(mocks.db.arsip.create.mock.calls[0][0].data.pencipta_unit).toBe("Pengguna Uji");
  });

  it("memakai retensi yang diisi sendiri, termasuk 0, bukan milik kategori", async () => {
    await tambah({ ...BODY_VALID, retensi_aktif_tahun: 5, retensi_inaktif_tahun: 0 });
    const data = mocks.db.arsip.create.mock.calls[0][0].data;
    expect(data.retensi_aktif_tahun).toBe(5);
    expect(data.retensi_inaktif_tahun).toBe(0);
  });

  it("mencatat penambahan di log modul 4", async () => {
    await tambah();
    expect(mocks.catatLog).toHaveBeenCalledWith({
      userId: USER_ID,
      userNama: "Pengguna Uji",
      modul: "4",
      aksi: "tambah",
      objek: "arsip",
      detail: "ARS-001 - Rapat Prodi",
    });
  });

  it("409 bila nomor arsip sudah dipakai", async () => {
    mocks.db.arsip.findFirst.mockResolvedValue({ id: 3 });
    const res = await tambah();

    expect(res.status).toBe(409);
    expect(await baca(res)).toEqual({ message: "Nomor arsip sudah dipakai." });
    expect(mocks.db.arsip.create).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it("409 bila dua permintaan bersamaan melanggar keunikan (P2002)", async () => {
    mocks.db.arsip.create.mockRejectedValue(galatPrisma("P2002"));
    expect((await tambah()).status).toBe(409);
  });

  it("400 bila kategori tidak ditemukan", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(null);
    const res = await tambah();
    expect(res.status).toBe(400);
    expect(mocks.db.arsip.create).not.toHaveBeenCalled();
  });

  it.each([
    ["nomor arsip kosong", { nomor_arsip: "" }],
    ["nomor surat kosong", { nomor_surat: "" }],
    ["judul kosong", { judul: "" }],
    ["link bukan http(s)", { link_berkas: "ftp://contoh.com/x" }],
    ["tanggal tidak ada di kalender", { tanggal_arsip: "2026-02-30" }],
  ])("400 untuk %s", async (_nama, ubah) => {
    const res = await tambah({ ...BODY_VALID, ...ubah });
    expect(res.status).toBe(400);
    expect(mocks.db.arsip.create).not.toHaveBeenCalled();
  });

  it("400 untuk body yang bukan JSON", async () => {
    expect((await tambah("{bukan json")).status).toBe(400);
  });
});

describe("PATCH /api/arsip/[id]", () => {
  const ubah = (body: unknown, id = "7") => PATCH(jsonRequest(`${URL_ARSIP}/${id}`, "PATCH", body), ctx(id));

  beforeEach(() => {
    mocks.db.arsip.findUnique.mockResolvedValue({ id: 7 });
    mocks.db.arsip.findFirst.mockResolvedValue(null);
    mocks.db.kategori.findUnique.mockResolvedValue(KATEGORI);
    mocks.db.arsip.update.mockResolvedValue({ ...ARSIP_TERSIMPAN, judul: "Judul Baru" });
  });

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await ubah({ judul: "Baru" });
    expect(res.status).toBe(403);
    expect(mocks.db.arsip.update).not.toHaveBeenCalled();
  });

  it("mengembalikan status validasi ke Pending dan menghapus catatan penolakan", async () => {
    const res = await ubah({ judul: "Judul Baru" });
    const arg = mocks.db.arsip.update.mock.calls[0][0];

    expect(res.status).toBe(200);
    expect(arg.where).toEqual({ id: 7 });
    expect(arg.data).toEqual({ judul: "Judul Baru", status_validasi: "Pending", catatan_validasi: null });
    expect((await baca(res)).message).toContain("Pending");
  });

  it("pencipta_unit dari body diabaikan saat edit", async () => {
    await ubah({ judul: "Judul Baru", pencipta_unit: "Unit Lain" });
    expect(mocks.db.arsip.update.mock.calls[0][0].data).not.toHaveProperty("pencipta_unit");
  });

  it("arsip yang Ditolak pun kembali ke Pending setelah diedit", async () => {
    mocks.db.arsip.update.mockResolvedValue({ ...ARSIP_TERSIMPAN, status_validasi: "Pending", catatan_validasi: null });
    await ubah({ nomor_surat: "002/UN/2026" });
    expect(mocks.db.arsip.update.mock.calls[0][0].data.status_validasi).toBe("Pending");
  });

  it("mencatat perubahan di log modul 4", async () => {
    await ubah({ judul: "Judul Baru" });
    expect(mocks.catatLog).toHaveBeenCalledWith(
      expect.objectContaining({ modul: "4", aksi: "ubah", objek: "arsip", detail: "ARS-001 - Judul Baru" }),
    );
  });

  it("409 bila nomor arsip baru dipakai arsip lain, dengan mengecualikan dirinya sendiri", async () => {
    mocks.db.arsip.findFirst.mockResolvedValue({ id: 9 });
    const res = await ubah({ nomor_arsip: "ARS-009" });

    expect(res.status).toBe(409);
    expect(mocks.db.arsip.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 7 });
    expect(mocks.db.arsip.update).not.toHaveBeenCalled();
  });

  it("400 bila kategori baru tidak ditemukan", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(null);
    expect((await ubah({ kategori_id: 99 })).status).toBe(400);
    expect(mocks.db.arsip.update).not.toHaveBeenCalled();
  });

  it("404 bila arsip tidak ada", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(null);
    expect((await ubah({ judul: "Baru" })).status).toBe(404);
  });

  it("400 untuk id tidak valid dan body tanpa field", async () => {
    expect((await ubah({ judul: "Baru" }, "abc")).status).toBe(400);
    expect((await ubah({})).status).toBe(400);
  });
});

describe("DELETE /api/arsip/[id]", () => {
  const hapus = (id = "7") => DELETE(new NextRequest(`${URL_ARSIP}/${id}`, { method: "DELETE" }), ctx(id));
  const arsipDenganTanggal = (tanggal: Date) => ({
    id: 7,
    nomor_arsip: "ARS-001",
    judul: "Rapat Prodi",
    tanggal_arsip: tanggal,
    retensi_aktif_tahun: 2,
    retensi_inaktif_tahun: 3,
  });

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await hapus();
    expect(res.status).toBe(403);
    expect(mocks.db.arsip.delete).not.toHaveBeenCalled();
  });

  it("409 bila status retensi masih Aktif, dan tidak dihapus", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(arsipDenganTanggal(new Date()));
    const res = await hapus();
    const body = await baca(res);

    expect(res.status).toBe(409);
    expect(body.message).toContain("Aktif");
    expect(mocks.db.arsip.delete).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it("409 bila status retensi masih Inaktif", async () => {
    const duaTahunLalu = new Date();
    duaTahunLalu.setUTCFullYear(duaTahunLalu.getUTCFullYear() - 3);
    mocks.db.arsip.findUnique.mockResolvedValue(arsipDenganTanggal(duaTahunLalu));

    const res = await hapus();

    expect(res.status).toBe(409);
    expect((await baca(res)).message).toContain("Inaktif");
    expect(mocks.db.arsip.delete).not.toHaveBeenCalled();
  });

  it("200 dan dihapus permanen bila status Dimusnahkan, lalu tercatat di log", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(arsipDenganTanggal(new Date("2000-01-01T00:00:00Z")));
    mocks.db.arsip.delete.mockResolvedValue({});

    const res = await hapus();

    expect(res.status).toBe(200);
    expect(mocks.db.arsip.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(mocks.catatLog).toHaveBeenCalledWith(
      expect.objectContaining({ modul: "4", aksi: "hapus", objek: "arsip", detail: "ARS-001 - Rapat Prodi" }),
    );
  });

  it("404 bila arsip tidak ada", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(null);
    expect((await hapus()).status).toBe(404);
    expect(mocks.db.arsip.delete).not.toHaveBeenCalled();
  });

  it("404 bila baris hilang saat dihapus (P2025)", async () => {
    mocks.db.arsip.findUnique.mockResolvedValue(arsipDenganTanggal(new Date("2000-01-01T00:00:00Z")));
    mocks.db.arsip.delete.mockRejectedValue(galatPrisma("P2025"));
    expect((await hapus()).status).toBe(404);
  });

  it("400 untuk id tidak valid", async () => {
    expect((await hapus("abc")).status).toBe(400);
  });
});
