import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { logAktivitas: { findMany, count } } }));

import { buildLogAktivitasWhere, listLogAktivitas, parseLogAktivitasFilters } from "@/lib/log-aktivitas-daftar";

const parse = (q: Record<string, string>) => parseLogAktivitasFilters(new URLSearchParams(q));

function filtersOk(q: Record<string, string>) {
  const hasil = parse(q);
  if (!hasil.ok) throw new Error(`seharusnya valid: ${hasil.message}`);
  return hasil.filters;
}

describe("parseLogAktivitasFilters", () => {
  it("tanpa parameter: tanpa filter, halaman 1, 10 per halaman", () => {
    expect(filtersOk({})).toEqual({
      modul: undefined,
      aksi: undefined,
      objek: undefined,
      dari: undefined,
      sebelum: undefined,
      page: 1,
      pageSize: 10,
    });
  });

  describe("filter modul", () => {
    it.each(["4", "7", "auth", "AUTH", " auth "])("menerima %j", (modul) => {
      expect(filtersOk({ modul }).modul).toBe(modul.trim().toLowerCase());
    });

    it.each(["5", "arsip", "4,7"])("menolak %j", (modul) => {
      expect(parse({ modul })).toEqual({ ok: false, message: "Parameter modul harus 4, 7, atau auth." });
    });
  });

  describe("filter aksi dan objek", () => {
    it.each(["tambah", "ubah", "hapus", "validasi", "sinkron", "login", "login_gagal"])("aksi %s diterima", (aksi) => {
      expect(filtersOk({ aksi }).aksi).toBe(aksi);
    });

    it.each(["arsip", "kategori", "dosen", "sso"])("objek %s diterima", (objek) => {
      expect(filtersOk({ objek }).objek).toBe(objek);
    });

    it("menolak aksi dan objek yang tidak dikenal", () => {
      expect(parse({ aksi: "hapus_semua" }).ok).toBe(false);
      expect(parse({ objek: "user" }).ok).toBe(false);
    });

    it("parameter kosong dianggap tidak difilter", () => {
      expect(filtersOk({ modul: "", aksi: " ", objek: "" })).toMatchObject({
        modul: undefined,
        aksi: undefined,
        objek: undefined,
      });
    });
  });

  describe("filter rentang tanggal (WIB)", () => {
    it("dari = 00.00 WIB, yaitu 17.00 UTC hari sebelumnya", () => {
      expect(filtersOk({ dari: "2026-11-21" }).dari?.toISOString()).toBe("2026-11-20T17:00:00.000Z");
    });

    it("sampai inklusif: batasnya 00.00 WIB hari berikutnya", () => {
      expect(filtersOk({ sampai: "2026-11-21" }).sebelum?.toISOString()).toBe("2026-11-21T17:00:00.000Z");
    });

    it("dari dan sampai di hari yang sama mencakup satu hari penuh", () => {
      const f = filtersOk({ dari: "2026-11-21", sampai: "2026-11-21" });
      expect(f.sebelum!.getTime() - f.dari!.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("melewati akhir bulan dan tahun kabisat dengan benar", () => {
      expect(filtersOk({ sampai: "2024-02-29" }).sebelum?.toISOString()).toBe("2024-02-29T17:00:00.000Z");
      expect(filtersOk({ sampai: "2026-12-31" }).sebelum?.toISOString()).toBe("2026-12-31T17:00:00.000Z");
    });

    it.each(["2026-02-30", "21-11-2026", "2026-11-21T00:00:00Z", "kemarin"])("menolak tanggal %j", (tanggal) => {
      expect(parse({ dari: tanggal }).ok).toBe(false);
      expect(parse({ sampai: tanggal }).ok).toBe(false);
    });

    it("menolak dari yang setelah sampai", () => {
      expect(parse({ dari: "2026-11-22", sampai: "2026-11-21" })).toEqual({
        ok: false,
        message: "Tanggal dari tidak boleh setelah tanggal sampai.",
      });
    });
  });

  describe("pagination", () => {
    it("membatasi pageSize antara 1 dan 50", () => {
      expect(filtersOk({ pageSize: "500" }).pageSize).toBe(50);
      expect(filtersOk({ pageSize: "0" }).pageSize).toBe(1);
      expect(filtersOk({ pageSize: "abc" }).pageSize).toBe(10);
    });

    it("halaman tidak valid kembali ke 1", () => {
      expect(filtersOk({ page: "-3" }).page).toBe(1);
      expect(filtersOk({ page: "x" }).page).toBe(1);
    });
  });
});

describe("buildLogAktivitasWhere", () => {
  it("tanpa filter: where kosong", () => {
    expect(buildLogAktivitasWhere(filtersOk({}))).toEqual({});
  });

  it("menggabungkan semua filter", () => {
    expect(
      buildLogAktivitasWhere(filtersOk({ modul: "4", aksi: "hapus", objek: "arsip", dari: "2026-11-01", sampai: "2026-11-30" })),
    ).toEqual({
      modul: "4",
      aksi: "hapus",
      objek: "arsip",
      created_at: {
        gte: new Date("2026-10-31T17:00:00.000Z"),
        lt: new Date("2026-11-30T17:00:00.000Z"),
      },
    });
  });

  it("hanya batas bawah atau hanya batas atas", () => {
    expect(buildLogAktivitasWhere(filtersOk({ dari: "2026-11-21" })).created_at).toEqual({
      gte: new Date("2026-11-20T17:00:00.000Z"),
    });
    expect(buildLogAktivitasWhere(filtersOk({ sampai: "2026-11-21" })).created_at).toEqual({
      lt: new Date("2026-11-21T17:00:00.000Z"),
    });
  });
});

describe("listLogAktivitas", () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    findMany.mockResolvedValue([{ id: 3 }, { id: 2 }]);
    count.mockResolvedValue(23);
  });

  it("urut terbaru di atas, dengan id sebagai pemecah seri", async () => {
    await listLogAktivitas(filtersOk({}));
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ created_at: "desc" }, { id: "desc" }]);
  });

  it("filter yang sama dipakai untuk data dan jumlah total", async () => {
    await listLogAktivitas(filtersOk({ modul: "auth", aksi: "login_gagal" }));
    expect(findMany.mock.calls[0][0].where).toEqual({ modul: "auth", aksi: "login_gagal" });
    expect(count).toHaveBeenCalledWith({ where: { modul: "auth", aksi: "login_gagal" } });
  });

  it("pagination: skip dan take sesuai halaman", async () => {
    const hasil = await listLogAktivitas(filtersOk({ page: "3", pageSize: "10" }));
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
    expect(hasil.pagination).toEqual({ page: 3, pageSize: 10, total: 23, totalPages: 3 });
  });

  it("tanpa hasil: totalPages tetap 1", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    const hasil = await listLogAktivitas(filtersOk({}));
    expect(hasil).toEqual({ items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } });
  });

  it("hanya memilih kolom log yang dibutuhkan", async () => {
    await listLogAktivitas(filtersOk({}));
    expect(Object.keys(findMany.mock.calls[0][0].select).sort()).toEqual(
      ["aksi", "created_at", "detail", "id", "modul", "objek", "user_id", "user_nama"].sort(),
    );
  });
});
