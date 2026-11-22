import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import {
  canDeleteArsip,
  formatArsipDetail,
  listArsipFromView,
  parseArsipListFilters,
  parseArsipPayload,
  parsePatchArsipPayload,
  resolveArsipRetention,
} from "@/lib/arsip";

const BASE = {
  nomor_arsip: "ARS-001",
  nomor_surat: "001/UN/2026",
  judul: "Rapat Prodi",
  kategori_id: 1,
  tanggal_arsip: "2026-03-10",
  link_berkas: "https://drive.google.com/file/abc",
};

describe("parseArsipPayload", () => {
  it("menerima payload minimal dan membiarkan retensi kosong", () => {
    const hasil = parseArsipPayload(BASE);
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.data.nomor_arsip).toBe("ARS-001");
    expect(hasil.data.tanggal_arsip.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(hasil.data).not.toHaveProperty("pencipta_unit");
    expect(hasil.data.keterangan).toBeNull();
    expect(hasil.data).not.toHaveProperty("retensi_aktif_tahun");
    expect(hasil.data).not.toHaveProperty("retensi_inaktif_tahun");
  });

  it("mengabaikan pencipta_unit dari body (diisi dari sesi di route)", () => {
    const hasil = parseArsipPayload({ ...BASE, pencipta_unit: "Unit Palsu", penciptaUnit: "Unit Lain" });
    expect(hasil.ok).toBe(true);
    expect(hasil.ok && hasil.data).not.toHaveProperty("pencipta_unit");
  });

  it("menerima nama field camelCase", () => {
    const hasil = parseArsipPayload({
      nomorArsip: "ARS-002",
      nomorSurat: "002/UN",
      judul: "Judul",
      kategoriId: "3",
      tanggalArsip: "2026-01-02",
      linkBerkas: "http://localhost:3000/berkas",
      retensiAktifTahun: 0,
      retensiInaktifTahun: 4,
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.data.kategori_id).toBe(3);
    expect(hasil.data.retensi_aktif_tahun).toBe(0);
    expect(hasil.data.retensi_inaktif_tahun).toBe(4);
  });

  it.each([
    ["nomor arsip", { nomor_arsip: "" }, "Nomor arsip"],
    ["nomor surat", { nomor_surat: "  " }, "Nomor surat"],
    ["judul", { judul: undefined }, "Judul arsip"],
  ])("menolak %s kosong", (_nama, ubah, pesan) => {
    const hasil = parseArsipPayload({ ...BASE, ...ubah });
    expect(hasil.ok).toBe(false);
    expect(!hasil.ok && hasil.message).toContain(pesan);
  });

  it.each([
    ["tidak dikirim", undefined],
    ["nol", 0],
    ["bukan angka", "abc"],
    ["pecahan", 1.5],
  ])("menolak kategori %s", (_nama, nilai) => {
    expect(parseArsipPayload({ ...BASE, kategori_id: nilai }).ok).toBe(false);
  });

  describe("tanggal arsip", () => {
    it.each(["2026-02-30", "2026-13-01", "10-03-2026", "bukan tanggal", ""])("menolak %j", (tanggal) => {
      expect(parseArsipPayload({ ...BASE, tanggal_arsip: tanggal }).ok).toBe(false);
    });

    it("menolak yang bukan teks", () => {
      expect(parseArsipPayload({ ...BASE, tanggal_arsip: 20260310 }).ok).toBe(false);
    });

    it("menerima 29 Februari tahun kabisat dan menolaknya di tahun biasa", () => {
      expect(parseArsipPayload({ ...BASE, tanggal_arsip: "2024-02-29" }).ok).toBe(true);
      expect(parseArsipPayload({ ...BASE, tanggal_arsip: "2025-02-29" }).ok).toBe(false);
    });

    it("membuang jam bila dikirim sebagai ISO penuh", () => {
      const hasil = parseArsipPayload({ ...BASE, tanggal_arsip: "2026-03-10T17:45:00.000Z" });
      expect(hasil.ok && hasil.data.tanggal_arsip.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    });
  });

  describe("link berkas", () => {
    it.each([
      "https://drive.google.com/file/abc",
      "http://contoh.ac.id/berkas.pdf",
      "http://localhost:3000/berkas",
    ])("menerima %s", (link) => {
      expect(parseArsipPayload({ ...BASE, link_berkas: link }).ok).toBe(true);
    });

    it.each([
      ["kosong", ""],
      ["bukan URL", "bukan url"],
      ["protokol ftp", "ftp://contoh.com/berkas"],
      ["host tanpa titik", "https://contoh"],
      ["tidak dikirim", undefined],
    ])("menolak link %s", (_nama, link) => {
      expect(parseArsipPayload({ ...BASE, link_berkas: link }).ok).toBe(false);
    });
  });

  it("menolak retensi negatif atau di atas batas smallint", () => {
    expect(parseArsipPayload({ ...BASE, retensi_aktif_tahun: -1 }).ok).toBe(false);
    expect(parseArsipPayload({ ...BASE, retensi_inaktif_tahun: 32768 }).ok).toBe(false);
  });

  it.each([null, [], "teks"])("menolak body yang bukan objek: %j", (body) => {
    expect(parseArsipPayload(body).ok).toBe(false);
  });
});

describe("parsePatchArsipPayload", () => {
  it("hanya memuat field yang dikirim", () => {
    expect(parsePatchArsipPayload({ judul: "Judul Baru" })).toEqual({
      ok: true,
      data: { judul: "Judul Baru" },
    });
  });

  it("menolak body tanpa field apa pun", () => {
    expect(parsePatchArsipPayload({}).ok).toBe(false);
  });

  it("menolak nilai yang tidak valid pada field yang dikirim", () => {
    expect(parsePatchArsipPayload({ link_berkas: "ftp://x.com" }).ok).toBe(false);
    expect(parsePatchArsipPayload({ tanggal_arsip: "2026-02-30" }).ok).toBe(false);
    expect(parsePatchArsipPayload({ nomor_arsip: " " }).ok).toBe(false);
  });

  it("pencipta_unit tidak bisa diubah lewat PATCH", () => {
    expect(parsePatchArsipPayload({ pencipta_unit: "Unit Lain" }).ok).toBe(false);
    expect(parsePatchArsipPayload({ judul: "Baru", penciptaUnit: "Unit Lain" })).toEqual({
      ok: true,
      data: { judul: "Baru" },
    });
  });

  it("mengosongkan field opsional dengan null", () => {
    expect(parsePatchArsipPayload({ keterangan: "" })).toEqual({ ok: true, data: { keterangan: null } });
  });
});

describe("resolveArsipRetention", () => {
  const kategori = { retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 };

  it("menyalin masa retensi dari kategori bila tidak diisi", () => {
    expect(resolveArsipRetention({}, kategori)).toEqual({ retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 });
  });

  it("memakai nilai yang diisi, termasuk 0", () => {
    expect(resolveArsipRetention({ retensi_aktif_tahun: 0, retensi_inaktif_tahun: 7 }, kategori)).toEqual({
      retensi_aktif_tahun: 0,
      retensi_inaktif_tahun: 7,
    });
  });

  it("boleh mengubah satu sisi saja", () => {
    expect(resolveArsipRetention({ retensi_aktif_tahun: 5 }, kategori)).toEqual({
      retensi_aktif_tahun: 5,
      retensi_inaktif_tahun: 3,
    });
  });
});

describe("parseArsipListFilters", () => {
  it("memakai nilai bawaan", () => {
    expect(parseArsipListFilters(new URLSearchParams())).toEqual({
      ok: true,
      filters: { search: "", kategoriId: undefined, kategoriKode: undefined, tahun: undefined, page: 1, pageSize: 10 },
    });
  });

  it("membatasi pageSize antara 1 dan 50", () => {
    const besar = parseArsipListFilters(new URLSearchParams({ pageSize: "500" }));
    const kecil = parseArsipListFilters(new URLSearchParams({ pageSize: "0" }));
    expect(besar.ok && besar.filters.pageSize).toBe(50);
    expect(kecil.ok && kecil.filters.pageSize).toBe(1);
  });

  it("halaman tidak valid kembali ke 1", () => {
    const hasil = parseArsipListFilters(new URLSearchParams({ page: "-5" }));
    expect(hasil.ok && hasil.filters.page).toBe(1);
  });

  it("memfilter kategori lewat id atau kode (kode dikapitalkan)", () => {
    const lewatId = parseArsipListFilters(new URLSearchParams({ kategori_id: "4" }));
    const lewatKode = parseArsipListFilters(new URLSearchParams({ kategori: "keu" }));
    expect(lewatId.ok && lewatId.filters.kategoriId).toBe(4);
    expect(lewatKode.ok && lewatKode.filters.kategoriKode).toBe("KEU");
  });

  it.each(["abc", "0", "10000", "2026.5"])("menolak tahun %j", (tahun) => {
    expect(parseArsipListFilters(new URLSearchParams({ tahun })).ok).toBe(false);
  });
});

describe("listArsipFromView", () => {
  const baris = {
    id: 1,
    nomor_arsip: "ARS-001",
    nomor_surat: "001/UN/2026",
    judul: "Rapat Prodi",
    kategori_id: 1,
    kategori_kode: "ADM",
    kategori_nama: "Arsip Administrasi",
    tanggal_arsip: new Date("2026-03-10T00:00:00.000Z"),
    retensi_aktif_tahun: 2,
    retensi_inaktif_tahun: 3,
  };

  const awal = { search: "", page: 1, pageSize: 10 };

  function panggilanDaftar() {
    const panggilan = queryRaw.mock.calls.find((p: unknown[]) => !(p[0] as string[]).join("").includes("COUNT(*)"));
    if (!panggilan) throw new Error("query daftar tidak dipanggil");
    const [strings, whereSql, limit, offset] = panggilan;
    return { teks: (strings as string[]).join(""), whereSql, limit, offset };
  }

  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockImplementation(async (strings: string[]) =>
      strings.join("").includes("COUNT(*)") ? [{ total: 25 }] : [baris],
    );
  });

  it("memetakan baris view menjadi item daftar tanpa status retensi dan validasi", async () => {
    const hasil = await listArsipFromView(awal);

    expect(hasil.items).toEqual([
      {
        id: 1,
        nomor_arsip: "ARS-001",
        nomor_surat: "001/UN/2026",
        judul: "Rapat Prodi",
        tanggal_arsip: baris.tanggal_arsip,
        kategori_id: 1,
        kategori: { kode: "ADM", nama: "Arsip Administrasi" },
        retensi_aktif_tahun: 2,
        retensi_inaktif_tahun: 3,
      },
    ]);
    expect(panggilanDaftar().teks).not.toMatch(/status/i);
  });

  describe("pencarian", () => {
    it("mencari judul, nomor surat, dan nomor arsip", async () => {
      await listArsipFromView({ ...awal, search: "rapat" });
      const { whereSql } = panggilanDaftar();

      expect(whereSql.sql).toContain('"judul" ILIKE');
      expect(whereSql.sql).toContain('"nomor_surat" ILIKE');
      expect(whereSql.sql).toContain('"nomor_arsip" ILIKE');
      expect(whereSql.values.filter((v: unknown) => v === "%rapat%")).toHaveLength(3);
    });

    it("menganggap % dan _ sebagai teks biasa", async () => {
      await listArsipFromView({ ...awal, search: "100%_" });
      expect(panggilanDaftar().whereSql.values).toContain("%100\\%\\_%");
    });

    it("tanpa kata kunci tidak ada filter pencarian", async () => {
      await listArsipFromView(awal);
      expect(panggilanDaftar().whereSql.sql).toBe("");
    });
  });

  describe("filter tahun", () => {
    it("membatasi tanggal arsip dari 1 Januari sampai sebelum 1 Januari tahun berikutnya", async () => {
      await listArsipFromView({ ...awal, tahun: 2025 });
      const { whereSql } = panggilanDaftar();

      expect(whereSql.sql).toContain('"tanggal_arsip" >=');
      expect(whereSql.sql).toContain('"tanggal_arsip" <');
      expect(whereSql.values).toEqual([new Date("2025-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")]);
    });
  });

  describe("filter kategori", () => {
    it("lewat id", async () => {
      await listArsipFromView({ ...awal, kategoriId: 3 });
      const { whereSql } = panggilanDaftar();
      expect(whereSql.sql).toContain('"kategori_id" =');
      expect(whereSql.values).toEqual([3]);
    });

    it("lewat kode", async () => {
      await listArsipFromView({ ...awal, kategoriKode: "KEU" });
      const { whereSql } = panggilanDaftar();
      expect(whereSql.sql).toContain('UPPER("kategori_kode")');
      expect(whereSql.values).toEqual(["KEU"]);
    });
  });

  it("menggabungkan beberapa filter dengan AND", async () => {
    await listArsipFromView({ ...awal, search: "rapat", tahun: 2025, kategoriId: 1 });
    const { whereSql } = panggilanDaftar();
    expect(whereSql.sql.startsWith("WHERE")).toBe(true);
    expect(whereSql.sql.match(/ AND /g)?.length).toBeGreaterThanOrEqual(2);
  });

  describe("paginasi", () => {
    it("halaman 1: offset 0", async () => {
      const hasil = await listArsipFromView({ ...awal, page: 1, pageSize: 10 });
      const { limit, offset } = panggilanDaftar();
      expect({ limit, offset }).toEqual({ limit: 10, offset: 0 });
      expect(hasil.pagination).toEqual({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    });

    it("halaman 3: offset 20", async () => {
      const hasil = await listArsipFromView({ ...awal, page: 3, pageSize: 10 });
      expect(panggilanDaftar().offset).toBe(20);
      expect(hasil.pagination.page).toBe(3);
    });

    it("ukuran halaman memengaruhi limit, offset, dan jumlah halaman", async () => {
      const hasil = await listArsipFromView({ ...awal, page: 2, pageSize: 5 });
      const { limit, offset } = panggilanDaftar();
      expect({ limit, offset }).toEqual({ limit: 5, offset: 5 });
      expect(hasil.pagination.totalPages).toBe(5);
    });

    it("tanpa hasil: totalPages tetap 1", async () => {
      queryRaw.mockImplementation(async (strings: string[]) =>
        strings.join("").includes("COUNT(*)") ? [{ total: 0 }] : [],
      );
      const hasil = await listArsipFromView(awal);
      expect(hasil.items).toEqual([]);
      expect(hasil.pagination).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
    });
  });
});

describe("canDeleteArsip", () => {
  it("mengizinkan hapus bila status retensi Dimusnahkan", () => {
    const hasil = canDeleteArsip({ tanggal_arsip: new Date("2000-01-01T00:00:00Z"), retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 });
    expect(hasil.allowed).toBe(true);
    expect(hasil.retensi.status).toBe("Dimusnahkan");
  });

  it("menolak hapus bila masih Aktif", () => {
    const hasil = canDeleteArsip({ tanggal_arsip: new Date(), retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 });
    expect(hasil.allowed).toBe(false);
    expect(hasil.retensi.status).toBe("Aktif");
  });

  it("menolak hapus bila masih Inaktif", () => {
    const sekarang = new Date("2026-11-21T00:00:00Z");
    const hasil = canDeleteArsip({ tanggal_arsip: new Date("2024-03-10T00:00:00Z"), retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3 }, sekarang);
    expect(hasil.allowed).toBe(false);
    expect(hasil.retensi.status).toBe("Inaktif");
  });

  it("retensi 0/0 langsung boleh dihapus di hari arsip", () => {
    const hari = new Date("2026-11-21T00:00:00Z");
    expect(canDeleteArsip({ tanggal_arsip: hari, retensi_aktif_tahun: 0, retensi_inaktif_tahun: 0 }, hari).allowed).toBe(true);
  });
});

describe("formatArsipDetail", () => {
  it("menambahkan status retensi dan tanggal habis", () => {
    const hasil = formatArsipDetail(
      { tanggal_arsip: new Date("2024-03-10T00:00:00Z"), retensi_aktif_tahun: 2, retensi_inaktif_tahun: 3, judul: "X" },
      new Date("2026-11-21T00:00:00Z"),
    );
    expect(hasil.status_retensi).toBe("Inaktif");
    expect(hasil.tanggal_habis_aktif.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(hasil.tanggal_habis_inaktif.toISOString()).toBe("2029-03-10T00:00:00.000Z");
    expect(hasil.judul).toBe("X");
  });
});
