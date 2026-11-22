import { describe, expect, it } from "vitest";
import { hitungRetensi } from "@/lib/retensi";

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("hitungRetensi", () => {
  it("menghitung tanggal habis aktif dan inaktif", () => {
    const h = hitungRetensi("2024-03-10", 2, 3, tgl("2024-03-10"));
    expect(iso(h.tanggalHabisAktif)).toBe("2026-03-10");
    expect(iso(h.tanggalHabisInaktif)).toBe("2029-03-10");
  });

  describe("batas tepat habis retensi", () => {
    const arsip = "2024-03-10";

    it("sehari sebelum habis aktif masih Aktif", () => {
      expect(hitungRetensi(arsip, 2, 3, tgl("2026-03-09")).status).toBe("Aktif");
    });

    it("di hari habis aktif sudah Inaktif", () => {
      expect(hitungRetensi(arsip, 2, 3, tgl("2026-03-10")).status).toBe("Inaktif");
    });

    it("sehari sebelum habis inaktif masih Inaktif", () => {
      expect(hitungRetensi(arsip, 2, 3, tgl("2029-03-09")).status).toBe("Inaktif");
    });

    it("di hari habis inaktif sudah Dimusnahkan", () => {
      expect(hitungRetensi(arsip, 2, 3, tgl("2029-03-10")).status).toBe("Dimusnahkan");
    });
  });

  describe("Dimusnahkan", () => {
    it("tetap Dimusnahkan lama setelah retensi habis", () => {
      expect(hitungRetensi("2010-01-01", 2, 3, tgl("2026-11-19")).status).toBe("Dimusnahkan");
    });
  });

  describe("tahun kabisat", () => {
    it("29 Februari + 1 tahun jatuh ke 28 Februari", () => {
      const h = hitungRetensi("2024-02-29", 1, 3, tgl("2024-02-29"));
      expect(iso(h.tanggalHabisAktif)).toBe("2025-02-28");
    });

    it("29 Februari + 4 tahun tetap 29 Februari", () => {
      const h = hitungRetensi("2024-02-29", 1, 3, tgl("2024-02-29"));
      expect(iso(h.tanggalHabisInaktif)).toBe("2028-02-29");
    });

    it("status berganti tepat di 28 Februari 2025", () => {
      expect(hitungRetensi("2024-02-29", 1, 3, tgl("2025-02-27")).status).toBe("Aktif");
      expect(hitungRetensi("2024-02-29", 1, 3, tgl("2025-02-28")).status).toBe("Inaktif");
    });

    it("tahun abad non-kabisat (2100) jatuh ke 28 Februari", () => {
      const h = hitungRetensi("2096-02-29", 4, 0, tgl("2096-02-29"));
      expect(iso(h.tanggalHabisAktif)).toBe("2100-02-28");
    });
  });

  describe("retensi 0 tahun", () => {
    it("aktif 0: di hari arsip langsung Inaktif", () => {
      const h = hitungRetensi("2026-11-19", 0, 3, tgl("2026-11-19"));
      expect(iso(h.tanggalHabisAktif)).toBe("2026-11-19");
      expect(h.status).toBe("Inaktif");
    });

    it("aktif 0 dan inaktif 0: di hari arsip langsung Dimusnahkan", () => {
      expect(hitungRetensi("2026-11-19", 0, 0, tgl("2026-11-19")).status).toBe("Dimusnahkan");
    });

    it("inaktif 0: setelah aktif habis langsung Dimusnahkan", () => {
      expect(hitungRetensi("2024-03-10", 2, 0, tgl("2026-03-10")).status).toBe("Dimusnahkan");
    });

    it("tanggal arsip di masa depan tetap Aktif", () => {
      expect(hitungRetensi("2027-01-01", 0, 0, tgl("2026-11-19")).status).toBe("Aktif");
    });
  });

  describe("tanggal tanpa jam", () => {
    it("jam pada hari ini tidak mengubah status", () => {
      const awal = hitungRetensi("2024-03-10", 2, 3, new Date("2026-03-10T00:00:00.000Z"));
      const akhir = hitungRetensi("2024-03-10", 2, 3, new Date("2026-03-10T23:59:59.999Z"));
      expect(awal.status).toBe("Inaktif");
      expect(akhir.status).toBe("Inaktif");
    });

    it("jam pada tanggal arsip diabaikan", () => {
      const h = hitungRetensi(new Date("2024-03-10T17:45:00.000Z"), 2, 3, tgl("2026-03-09"));
      expect(iso(h.tanggalHabisAktif)).toBe("2026-03-10");
      expect(h.status).toBe("Aktif");
    });

    it("string dan Date menghasilkan hasil sama", () => {
      const a = hitungRetensi("2024-03-10", 2, 3, tgl("2026-03-10"));
      const b = hitungRetensi(tgl("2024-03-10"), 2, 3, tgl("2026-03-10"));
      expect(a).toEqual(b);
    });
  });

  describe("input tidak valid", () => {
    it("menolak retensi negatif atau pecahan", () => {
      expect(() => hitungRetensi("2024-03-10", -1, 3)).toThrow(RangeError);
      expect(() => hitungRetensi("2024-03-10", 2, 1.5)).toThrow(RangeError);
      expect(() => hitungRetensi("2024-03-10", Number.NaN, 3)).toThrow(RangeError);
    });

    it("menolak tanggal arsip yang tidak valid", () => {
      expect(() => hitungRetensi("bukan-tanggal", 2, 3)).toThrow(RangeError);
      expect(() => hitungRetensi("2025-02-30", 2, 3)).toThrow(RangeError);
      expect(() => hitungRetensi(new Date("x"), 2, 3)).toThrow(RangeError);
    });
  });
});
