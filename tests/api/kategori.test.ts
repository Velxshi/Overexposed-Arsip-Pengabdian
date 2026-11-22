import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ctx, jsonRequest, PERAN_NON_STAFF, PERAN_STAFF, sesi, USER_ID } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  catatLog: vi.fn(),
  db: {
    kategori: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/log-aktivitas", () => ({ catatLog: mocks.catatLog }));

import { Prisma } from "@/generated/prisma/client";
import { DELETE, PATCH } from "@/app/api/arsip/kategori/[id]/route";
import { GET, POST } from "@/app/api/arsip/kategori/route";

const URL_KATEGORI = "http://localhost/api/arsip/kategori";
const KATEGORI = {
  id: 1,
  kode: "KEU",
  nama: "Arsip Keuangan",
  retensi_aktif_tahun: 2,
  retensi_inaktif_tahun: 8,
  keterangan: null,
};
const BODY_VALID = { kode: "keu", nama: "Arsip Keuangan", retensiAktifTahun: 2, retensiInaktifTahun: 8 };

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

describe("GET /api/arsip/kategori", () => {
  beforeEach(() => {
    mocks.db.kategori.findMany.mockResolvedValue([{ ...KATEGORI, _count: { arsip: 4 } }]);
    mocks.db.kategori.count.mockResolvedValue(1);
  });

  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await GET(new NextRequest(URL_KATEGORI));
    expect(res.status).toBe(401);
    expect(await baca(res)).toEqual({ message: "Silakan login terlebih dahulu." });
  });

  it.each([
    ["Staff Kaprodi", 200],
    ["Admin", 200],
    ["Kaprodi", 200],
    ["Dosen", 403],
    ["Mahasiswa", 403],
    ["Umum", 403],
  ])("peran %s mendapat %i", async (peran, status) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await GET(new NextRequest(URL_KATEGORI));
    expect(res.status).toBe(status);
    if (status === 403) expect(mocks.db.kategori.findMany).not.toHaveBeenCalled();
  });

  it("menampilkan jumlah_arsip per kategori tanpa membocorkan _count", async () => {
    const res = await GET(new NextRequest(URL_KATEGORI));
    const body = (await baca(res)) as { items: Record<string, unknown>[]; pagination: unknown };

    expect(body.items).toHaveLength(1);
    expect(body.items[0].jumlah_arsip).toBe(4);
    expect(body.items[0]).not.toHaveProperty("_count");
    expect(body.pagination).toEqual({ page: 1, pageSize: 6, total: 1, totalPages: 1 });
  });

  it("jumlah_arsip 0 untuk kategori tanpa arsip", async () => {
    mocks.db.kategori.findMany.mockResolvedValue([{ ...KATEGORI, _count: { arsip: 0 } }]);
    const body = (await baca(await GET(new NextRequest(URL_KATEGORI)))) as { items: { jumlah_arsip: number }[] };
    expect(body.items[0].jumlah_arsip).toBe(0);
  });

  it("menyaring berdasarkan kode atau nama tanpa membedakan huruf besar kecil", async () => {
    await GET(new NextRequest(`${URL_KATEGORI}?search=KeU`));
    const args = mocks.db.kategori.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      AND: [
        {
          OR: [
            { kode: { contains: "KeU", mode: "insensitive" } },
            { nama: { contains: "KeU", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("menerapkan paginasi", async () => {
    mocks.db.kategori.count.mockResolvedValue(14);
    const res = await GET(new NextRequest(`${URL_KATEGORI}?page=2`));
    const args = mocks.db.kategori.findMany.mock.calls[0][0];
    const body = await baca(res);

    expect(args.skip).toBe(6);
    expect(args.take).toBe(6);
    expect(body.pagination).toEqual({ page: 2, pageSize: 6, total: 14, totalPages: 3 });
  });

  it("400 untuk filter retensi yang tidak valid", async () => {
    const res = await GET(new NextRequest(`${URL_KATEGORI}?retensi=abc`));
    expect(res.status).toBe(400);
    expect(mocks.db.kategori.findMany).not.toHaveBeenCalled();
  });

  it("500 bila database gagal", async () => {
    mocks.db.kategori.findMany.mockRejectedValue(new Error("db mati"));
    const res = await GET(new NextRequest(URL_KATEGORI));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/arsip/kategori", () => {
  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));
    expect(res.status).toBe(401);
  });

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403 dan tidak ada yang tersimpan", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));

    expect(res.status).toBe(403);
    expect(await baca(res)).toEqual({ message: "Anda tidak memiliki izin untuk mengelola kategori arsip." });
    expect(mocks.db.kategori.create).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it.each(PERAN_STAFF)("peran %s boleh menambah (201), kode dikapitalkan, dan tercatat di log", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    mocks.db.kategori.findFirst.mockResolvedValue(null);
    mocks.db.kategori.create.mockResolvedValue(KATEGORI);

    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));

    expect(res.status).toBe(201);
    expect(mocks.db.kategori.create.mock.calls[0][0].data).toEqual({
      kode: "KEU",
      nama: "Arsip Keuangan",
      retensi_aktif_tahun: 2,
      retensi_inaktif_tahun: 8,
      keterangan: null,
    });
    expect(mocks.catatLog).toHaveBeenCalledWith({
      userId: USER_ID,
      userNama: "Pengguna Uji",
      modul: "4",
      aksi: "tambah",
      objek: "kategori",
      detail: "KEU - Arsip Keuangan",
    });
  });

  describe("validasi kode", () => {
    it.each([["ABCDEF"], ["AB1"], ["K-U"], [""]])("400 untuk kode %j", async (kode) => {
      const res = await POST(jsonRequest(URL_KATEGORI, "POST", { ...BODY_VALID, kode }));
      expect(res.status).toBe(400);
      expect(mocks.db.kategori.create).not.toHaveBeenCalled();
    });
  });

  it("409 bila kode sudah dipakai (tanpa membedakan huruf besar kecil)", async () => {
    mocks.db.kategori.findFirst.mockResolvedValue({ id: 3 });
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));

    expect(res.status).toBe(409);
    expect(await baca(res)).toEqual({ message: "Kode kategori sudah dipakai." });
    expect(mocks.db.kategori.findFirst.mock.calls[0][0].where.kode).toEqual({ equals: "KEU", mode: "insensitive" });
    expect(mocks.db.kategori.create).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it("409 bila dua permintaan bersamaan melanggar keunikan (P2002)", async () => {
    mocks.db.kategori.findFirst.mockResolvedValue(null);
    mocks.db.kategori.create.mockRejectedValue(galatPrisma("P2002"));
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));
    expect(res.status).toBe(409);
  });

  it("400 untuk body yang bukan JSON", async () => {
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", "{bukan json"));
    expect(res.status).toBe(400);
  });

  it("400 untuk retensi yang tidak valid", async () => {
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", { ...BODY_VALID, retensiAktifTahun: 0 }));
    expect(res.status).toBe(400);
  });

  it("500 dan tidak mencatat log bila database gagal", async () => {
    mocks.db.kategori.findFirst.mockResolvedValue(null);
    mocks.db.kategori.create.mockRejectedValue(new Error("db mati"));
    const res = await POST(jsonRequest(URL_KATEGORI, "POST", BODY_VALID));
    expect(res.status).toBe(500);
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/arsip/kategori/[id]", () => {
  const ubah = (body: unknown, id = "1") => PATCH(jsonRequest(`${URL_KATEGORI}/${id}`, "PATCH", body), ctx(id));

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await ubah({ nama: "Baru" });
    expect(res.status).toBe(403);
    expect(mocks.db.kategori.update).not.toHaveBeenCalled();
  });

  it("200 untuk Staff Kaprodi dan tercatat di log", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue({ id: 1 });
    mocks.db.kategori.update.mockResolvedValue({ ...KATEGORI, nama: "Nama Baru" });

    const res = await ubah({ nama: "Nama Baru" });

    expect(res.status).toBe(200);
    expect(mocks.db.kategori.update.mock.calls[0][0]).toMatchObject({ where: { id: 1 }, data: { nama: "Nama Baru" } });
    expect(mocks.catatLog).toHaveBeenCalledWith(
      expect.objectContaining({ modul: "4", aksi: "ubah", objek: "kategori", detail: "KEU - Nama Baru" }),
    );
  });

  it("404 bila kategori tidak ada", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(null);
    const res = await ubah({ nama: "Baru" });
    expect(res.status).toBe(404);
    expect(mocks.db.kategori.update).not.toHaveBeenCalled();
  });

  it("409 bila kode baru sudah dipakai kategori lain, dengan mengecualikan dirinya sendiri", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue({ id: 1 });
    mocks.db.kategori.findFirst.mockResolvedValue({ id: 2 });

    const res = await ubah({ kode: "ADM" });

    expect(res.status).toBe(409);
    expect(mocks.db.kategori.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 1 });
    expect(mocks.db.kategori.update).not.toHaveBeenCalled();
  });

  it("400 untuk id yang bukan angka", async () => {
    const res = await ubah({ nama: "Baru" }, "abc");
    expect(res.status).toBe(400);
  });

  it("400 untuk body tanpa field", async () => {
    const res = await ubah({});
    expect(res.status).toBe(400);
  });

  it("404 bila baris hilang di tengah proses (P2025)", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue({ id: 1 });
    mocks.db.kategori.update.mockRejectedValue(galatPrisma("P2025"));
    const res = await ubah({ nama: "Baru" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/arsip/kategori/[id]", () => {
  const hapus = (id = "1") => DELETE(new NextRequest(`${URL_KATEGORI}/${id}`, { method: "DELETE" }), ctx(id));
  const kategoriDipakai = (jumlah: number) => ({ id: 1, kode: "KEU", nama: "Arsip Keuangan", _count: { arsip: jumlah } });

  it.each(PERAN_NON_STAFF)("peran %s ditolak 403", async (peran) => {
    mocks.getSession.mockResolvedValue(sesi(peran));
    const res = await hapus();
    expect(res.status).toBe(403);
    expect(mocks.db.kategori.delete).not.toHaveBeenCalled();
  });

  it("409 dengan pesan jelas bila kategori masih dipakai arsip", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(kategoriDipakai(2));

    const res = await hapus();

    expect(res.status).toBe(409);
    expect(await baca(res)).toEqual({ message: "Kategori tidak dapat dihapus karena masih digunakan oleh arsip." });
    expect(mocks.db.kategori.delete).not.toHaveBeenCalled();
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it("200 bila tidak dipakai arsip, dan tercatat di log", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(kategoriDipakai(0));
    mocks.db.kategori.delete.mockResolvedValue({});

    const res = await hapus();

    expect(res.status).toBe(200);
    expect(mocks.db.kategori.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(mocks.catatLog).toHaveBeenCalledWith(
      expect.objectContaining({ modul: "4", aksi: "hapus", objek: "kategori", detail: "KEU - Arsip Keuangan" }),
    );
  });

  it("409 bila database menolak karena relasi (P2003)", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(kategoriDipakai(0));
    mocks.db.kategori.delete.mockRejectedValue(galatPrisma("P2003"));
    const res = await hapus();
    expect(res.status).toBe(409);
    expect(mocks.catatLog).not.toHaveBeenCalled();
  });

  it("404 bila kategori tidak ada", async () => {
    mocks.db.kategori.findUnique.mockResolvedValue(null);
    expect((await hapus()).status).toBe(404);
  });

  it("400 untuk id yang tidak valid", async () => {
    expect((await hapus("0")).status).toBe(400);
  });
});
