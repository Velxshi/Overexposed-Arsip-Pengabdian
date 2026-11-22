import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { formatTanggal, getDashboardArsip, parseDashboardFilters } from "@/lib/dashboard";

type Sql = { sql: string; values: unknown[] };

const BARIS = [
  {
    id: 9,
    nomor_arsip: "ARS-009",
    nomor_surat: "009/UN/2026",
    judul: "Arsip paling baru",
    kategori_kode: "ADM",
    kategori_nama: "Arsip Administrasi",
    tanggal_arsip: new Date("2026-11-20T00:00:00.000Z"),
  },
  {
    id: 4,
    nomor_arsip: "ARS-004",
    nomor_surat: "004/UN/2026",
    judul: "Arsip lebih lama",
    kategori_kode: "KEU",
    kategori_nama: "Arsip Keuangan",
    tanggal_arsip: new Date("2024-02-29T00:00:00.000Z"),
  },
];

const awal = { search: "", page: 1, pageSize: 5 };

function teks(panggilan: unknown[]) {
  return (panggilan[0] as string[]).join("");
}

function panggilan(jenis: "aktif" | "daftar" | "jumlah") {
  const hasil = queryRaw.mock.calls.find((p: unknown[]) => {
    const t = teks(p);
    if (jenis === "aktif") return t.includes("'Aktif'");
    if (jenis === "jumlah") return t.includes("COUNT(*)") && !t.includes("'Aktif'");
    return !t.includes("COUNT(*)");
  });
  if (!hasil) throw new Error(`query ${jenis} tidak dipanggil`);
  return hasil as unknown[];
}

function aturHasil({ aktif = 3, total = 12, baris = BARIS }: { aktif?: number; total?: number; baris?: typeof BARIS } = {}) {
  queryRaw.mockImplementation(async (strings: string[]) => {
    const t = strings.join("");
    if (t.includes("'Aktif'")) return [{ total: aktif }];
    if (t.includes("COUNT(*)")) return [{ total }];
    return baris;
  });
}

beforeEach(() => {
  queryRaw.mockReset();
  aturHasil();
});

describe("parseDashboardFilters", () => {
  it("memakai nilai bawaan: 5 per halaman", () => {
    expect(parseDashboardFilters(new URLSearchParams())).toEqual({ search: "", page: 1, pageSize: 5 });
  });

  it("membatasi pageSize antara 1 dan 50", () => {
    expect(parseDashboardFilters(new URLSearchParams({ pageSize: "999" })).pageSize).toBe(50);
    expect(parseDashboardFilters(new URLSearchParams({ pageSize: "0" })).pageSize).toBe(1);
    expect(parseDashboardFilters(new URLSearchParams({ pageSize: "abc" })).pageSize).toBe(5);
  });

  it("halaman tidak valid kembali ke 1", () => {
    expect(parseDashboardFilters(new URLSearchParams({ page: "-2" })).page).toBe(1);
    expect(parseDashboardFilters(new URLSearchParams({ page: "x" })).page).toBe(1);
  });

  it("merapikan dan memotong kata kunci menjadi 100 karakter", () => {
    expect(parseDashboardFilters(new URLSearchParams({ search: "  rapat  " })).search).toBe("rapat");
    expect(parseDashboardFilters(new URLSearchParams({ search: "x".repeat(150) })).search).toHaveLength(100);
  });
});

describe("formatTanggal", () => {
  it("mengembalikan tanggal tanpa jam", () => {
    expect(formatTanggal(new Date("2026-03-10T00:00:00.000Z"))).toBe("2026-03-10");
    expect(formatTanggal(new Date("2024-02-29T00:00:00.000Z"))).toBe("2024-02-29");
  });
});

describe("getDashboardArsip", () => {
  describe("totalArsip", () => {
    it("menghitung arsip berstatus retensi Aktif dari v_arsip", async () => {
      aturHasil({ aktif: 7 });
      const hasil = await getDashboardArsip(awal);

      expect(hasil.totalArsip).toBe(7);
      const t = teks(panggilan("aktif"));
      expect(t).toContain('FROM "v_arsip"');
      expect(t).toContain(`"status" = 'Aktif'`);
    });

    it("tidak terpengaruh pencarian", async () => {
      await getDashboardArsip({ ...awal, search: "rapat" });
      expect(panggilan("aktif")).toHaveLength(1);
    });

    it("0 bila belum ada arsip Aktif", async () => {
      queryRaw.mockImplementation(async (strings: string[]) => (strings.join("").includes("COUNT(*)") ? [] : []));
      const hasil = await getDashboardArsip(awal);
      expect(hasil.totalArsip).toBe(0);
      expect(hasil.aktivitasTerbaru.pagination.total).toBe(0);
    });
  });

  describe("urutan aktivitasTerbaru", () => {
    it("diurutkan dari created_at terbaru, dengan id sebagai pemecah seri", async () => {
      await getDashboardArsip(awal);
      expect(teks(panggilan("daftar"))).toMatch(/ORDER BY "created_at" DESC, "id" DESC/);
    });

    it("mempertahankan urutan dari database", async () => {
      const hasil = await getDashboardArsip(awal);
      expect(hasil.aktivitasTerbaru.items.map((i) => i.id)).toEqual([9, 4]);
    });
  });

  describe("isi item", () => {
    it("memuat nomor arsip, judul, kategori, nomor surat, dan tanggal tanpa jam", async () => {
      const hasil = await getDashboardArsip(awal);
      expect(hasil.aktivitasTerbaru.items[0]).toEqual({
        id: 9,
        nomor_arsip: "ARS-009",
        judul: "Arsip paling baru",
        kategori: { kode: "ADM", nama: "Arsip Administrasi" },
        nomor_surat: "009/UN/2026",
        tanggal_arsip: "2026-11-20",
      });
      expect(hasil.aktivitasTerbaru.items[1].tanggal_arsip).toBe("2024-02-29");
    });

    it("tidak memuat badge Masuk/Keluar, pengirim, atau status", async () => {
      await getDashboardArsip(awal);
      const t = teks(panggilan("daftar"));
      expect(t).not.toMatch(/status|pengirim|jenis/i);
    });
  });

  describe("pencarian", () => {
    it("mencari judul, nomor surat, dan nomor arsip", async () => {
      await getDashboardArsip({ ...awal, search: "rapat" });
      const where = panggilan("daftar")[1] as Sql;

      expect(where.sql).toContain('"judul" ILIKE');
      expect(where.sql).toContain('"nomor_surat" ILIKE');
      expect(where.sql).toContain('"nomor_arsip" ILIKE');
      expect(where.values.filter((v) => v === "%rapat%")).toHaveLength(3);
    });

    it("filter yang sama dipakai untuk jumlah total", async () => {
      await getDashboardArsip({ ...awal, search: "rapat" });
      const whereDaftar = panggilan("daftar")[1] as Sql;
      const whereJumlah = panggilan("jumlah")[1] as Sql;
      expect(whereJumlah.sql).toBe(whereDaftar.sql);
      expect(whereJumlah.values).toEqual(whereDaftar.values);
    });

    it("menganggap % dan _ sebagai teks biasa", async () => {
      await getDashboardArsip({ ...awal, search: "50%_" });
      expect((panggilan("daftar")[1] as Sql).values).toContain("%50\\%\\_%");
    });

    it("tanpa kata kunci tidak ada filter", async () => {
      await getDashboardArsip(awal);
      expect((panggilan("daftar")[1] as Sql).sql).toBe("");
    });
  });

  describe("pagination", () => {
    it("halaman pertama: 5 item, offset 0", async () => {
      const hasil = await getDashboardArsip(awal);
      const [, , limit, offset] = panggilan("daftar");

      expect({ limit, offset }).toEqual({ limit: 5, offset: 0 });
      expect(hasil.aktivitasTerbaru.pagination).toEqual({ page: 1, pageSize: 5, total: 12, totalPages: 3 });
    });

    it("halaman 3 dengan 5 item: offset 10", async () => {
      const hasil = await getDashboardArsip({ ...awal, page: 3 });
      expect(panggilan("daftar")[3]).toBe(10);
      expect(hasil.aktivitasTerbaru.pagination.page).toBe(3);
    });

    it("menyediakan angka untuk teks 'Menampilkan X dari Y'", async () => {
      aturHasil({ total: 2 });
      const hasil = await getDashboardArsip(awal);
      expect(hasil.aktivitasTerbaru.items).toHaveLength(2);
      expect(hasil.aktivitasTerbaru.pagination.total).toBe(2);
    });

    it("tanpa hasil: totalPages tetap 1", async () => {
      aturHasil({ total: 0, baris: [] });
      const hasil = await getDashboardArsip({ ...awal, search: "tidak ada" });
      expect(hasil.aktivitasTerbaru).toEqual({
        items: [],
        pagination: { page: 1, pageSize: 5, total: 0, totalPages: 1 },
      });
    });
  });
});
