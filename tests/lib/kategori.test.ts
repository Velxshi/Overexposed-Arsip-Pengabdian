import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import {
  buildKategoriWhere,
  parseCreateKategoriPayload,
  parseKategoriIdParam,
  parsePatchKategoriPayload,
} from "@/lib/kategori";

const BASE = { kode: "KEU", nama: "Arsip Keuangan", retensiAktifTahun: 2, retensiInaktifTahun: 8 };

describe("parseCreateKategoriPayload", () => {
  it("menerima payload valid dan merapikan nilainya", () => {
    const hasil = parseCreateKategoriPayload({
      kode: " keu ",
      nama: "  Arsip Keuangan ",
      retensiAktifTahun: 2,
      retensiInaktifTahun: "8",
      keterangan: "  catatan  ",
    });

    expect(hasil).toEqual({
      ok: true,
      data: {
        kode: "KEU",
        nama: "Arsip Keuangan",
        retensi_aktif_tahun: 2,
        retensi_inaktif_tahun: 8,
        keterangan: "catatan",
      },
    });
  });

  it("menerima nama field snake_case", () => {
    const hasil = parseCreateKategoriPayload({
      kode: "TI",
      nama: "Teknologi Informasi",
      retensi_aktif_tahun: 2,
      retensi_inaktif_tahun: 3,
    });
    expect(hasil.ok).toBe(true);
  });

  it("keterangan kosong menjadi null", () => {
    const hasil = parseCreateKategoriPayload({ ...BASE, keterangan: "   " });
    expect(hasil.ok && hasil.data.keterangan).toBeNull();
  });

  describe("validasi kode", () => {
    it.each([
      ["kosong", ""],
      ["hanya spasi", "   "],
      ["lebih dari 5 karakter", "ABCDEF"],
      ["memuat angka", "AB1"],
      ["memuat spasi", "A B"],
      ["memuat tanda baca", "K-U"],
      ["bukan teks", 123],
      ["tidak dikirim", undefined],
    ])("menolak kode %s", (_nama, kode) => {
      const hasil = parseCreateKategoriPayload({ ...BASE, kode });
      expect(hasil.ok).toBe(false);
      expect(!hasil.ok && hasil.message).toContain("Kode kategori");
    });

    it.each(["A", "TI", "KEU", "ADMIN", "abcde"])("menerima kode %s (maksimal 5 huruf)", (kode) => {
      const hasil = parseCreateKategoriPayload({ ...BASE, kode });
      expect(hasil.ok).toBe(true);
      expect(hasil.ok && hasil.data.kode).toBe(kode.toUpperCase());
    });
  });

  it("menolak nama kosong", () => {
    const hasil = parseCreateKategoriPayload({ ...BASE, nama: "  " });
    expect(hasil).toEqual({ ok: false, message: "Nama kategori harus diisi." });
  });

  it("menolak keterangan yang bukan teks", () => {
    const hasil = parseCreateKategoriPayload({ ...BASE, keterangan: 5 });
    expect(hasil).toEqual({ ok: false, message: "Keterangan harus berupa teks." });
  });

  describe("validasi retensi", () => {
    it.each([
      ["tidak dikirim", undefined],
      ["nol", 0],
      ["negatif", -1],
      ["pecahan", 1.5],
      ["huruf", "dua"],
      ["terlalu besar untuk smallint", 32768],
    ])("menolak retensi aktif %s", (_nama, nilai) => {
      const hasil = parseCreateKategoriPayload({ ...BASE, retensiAktifTahun: nilai });
      expect(hasil.ok).toBe(false);
      expect(!hasil.ok && hasil.message).toContain("Retensi aktif");
    });

    it("menolak retensi inaktif yang tidak valid", () => {
      const hasil = parseCreateKategoriPayload({ ...BASE, retensiInaktifTahun: 0 });
      expect(hasil.ok).toBe(false);
      expect(!hasil.ok && hasil.message).toContain("Retensi inaktif");
    });
  });

  it.each([null, [], "teks", 5])("menolak body yang bukan objek: %j", (body) => {
    expect(parseCreateKategoriPayload(body)).toEqual({ ok: false, message: "Body request tidak valid." });
  });
});

describe("parsePatchKategoriPayload", () => {
  it("hanya memuat field yang dikirim", () => {
    const hasil = parsePatchKategoriPayload({ nama: "Nama Baru" });
    expect(hasil).toEqual({ ok: true, data: { nama: "Nama Baru" } });
  });

  it("menormalkan kode ke huruf kapital", () => {
    const hasil = parsePatchKategoriPayload({ kode: "ops" });
    expect(hasil).toEqual({ ok: true, data: { kode: "OPS" } });
  });

  it("menolak body tanpa field apa pun", () => {
    const hasil = parsePatchKategoriPayload({});
    expect(hasil.ok).toBe(false);
  });

  it("menolak kode yang tidak valid", () => {
    expect(parsePatchKategoriPayload({ kode: "TERLALU" }).ok).toBe(false);
  });

  it("menolak retensi nol", () => {
    expect(parsePatchKategoriPayload({ retensi_aktif_tahun: 0 }).ok).toBe(false);
  });
});

describe("parseKategoriIdParam", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("menerima %s", (mentah, hasil) => {
    expect(parseKategoriIdParam(mentah)).toBe(hasil);
  });

  it.each(["0", "-1", "abc", "1.5", "", "2147483648", "99999999999999999999"])("menolak %j", (mentah) => {
    expect(parseKategoriIdParam(mentah)).toBeNull();
  });
});

describe("buildKategoriWhere", () => {
  it("tanpa parameter tidak memfilter apa pun", () => {
    expect(buildKategoriWhere(new URLSearchParams())).toEqual({ ok: true, where: {} });
  });

  it("mencari kode atau nama tanpa membedakan huruf besar kecil", () => {
    const hasil = buildKategoriWhere(new URLSearchParams({ search: "  keu " }));
    expect(hasil).toEqual({
      ok: true,
      where: {
        AND: [
          {
            OR: [
              { kode: { contains: "keu", mode: "insensitive" } },
              { nama: { contains: "keu", mode: "insensitive" } },
            ],
          },
        ],
      },
    });
  });

  it("memotong kata kunci pencarian menjadi 100 karakter", () => {
    const hasil = buildKategoriWhere(new URLSearchParams({ search: "x".repeat(150) }));
    const kondisi = hasil.ok && (hasil.where.AND as { OR: { kode: { contains: string } }[] }[])[0];
    expect(kondisi && kondisi.OR[0].kode.contains).toHaveLength(100);
  });

  it("memfilter masa retensi format aktif/inaktif", () => {
    const hasil = buildKategoriWhere(new URLSearchParams({ retensi: "2/8" }));
    expect(hasil).toEqual({
      ok: true,
      where: { AND: [{ retensi_aktif_tahun: 2, retensi_inaktif_tahun: 8 }] },
    });
  });

  it("retensi satu angka cocok dengan aktif atau inaktif", () => {
    const hasil = buildKategoriWhere(new URLSearchParams({ retensi: "3" }));
    expect(hasil).toEqual({
      ok: true,
      where: { AND: [{ OR: [{ retensi_aktif_tahun: 3 }, { retensi_inaktif_tahun: 3 }] }] },
    });
  });

  it("memfilter retensi aktif saja", () => {
    const hasil = buildKategoriWhere(new URLSearchParams({ retensi_aktif: "2" }));
    expect(hasil).toEqual({ ok: true, where: { AND: [{ retensi_aktif_tahun: 2 }] } });
  });

  it.each(["abc", "2/", "/3", "1/2/3", "2/x"])("menolak retensi %j", (retensi) => {
    expect(buildKategoriWhere(new URLSearchParams({ retensi })).ok).toBe(false);
  });

  it("menolak retensi_aktif_tahun yang bukan angka", () => {
    expect(buildKategoriWhere(new URLSearchParams({ retensi_aktif_tahun: "dua" })).ok).toBe(false);
  });
});
