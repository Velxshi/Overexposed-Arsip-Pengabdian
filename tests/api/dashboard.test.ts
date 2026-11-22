import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sesi } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: { $queryRaw: vi.fn() },
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET } from "@/app/api/dashboard/route";

const URL_DASHBOARD = "http://localhost/api/dashboard";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(sesi("Staff Kaprodi"));
  mocks.db.$queryRaw.mockImplementation(async (strings: string[]) => {
    const t = strings.join("");
    if (t.includes("'Aktif'")) return [{ total: 4 }];
    if (t.includes("COUNT(*)")) return [{ total: 1 }];
    return [
      {
        id: 1,
        nomor_arsip: "ARS-001",
        nomor_surat: "001/UN/2026",
        judul: "Rapat Prodi",
        kategori_kode: "ADM",
        kategori_nama: "Arsip Administrasi",
        tanggal_arsip: new Date("2026-03-10T00:00:00.000Z"),
      },
    ];
  });
});

describe("GET /api/dashboard", () => {
  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await GET(new NextRequest(URL_DASHBOARD));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Silakan login terlebih dahulu." });
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
    const res = await GET(new NextRequest(URL_DASHBOARD));
    expect(res.status).toBe(status);
    if (status === 403) {
      expect(await res.json()).toEqual({ message: "Anda tidak memiliki izin untuk melihat arsip." });
      expect(mocks.db.$queryRaw).not.toHaveBeenCalled();
    }
  });

  it("mengembalikan totalArsip dan aktivitasTerbaru", async () => {
    const res = await GET(new NextRequest(URL_DASHBOARD));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      totalArsip: 4,
      aktivitasTerbaru: {
        items: [
          {
            id: 1,
            nomor_arsip: "ARS-001",
            judul: "Rapat Prodi",
            kategori: { kode: "ADM", nama: "Arsip Administrasi" },
            nomor_surat: "001/UN/2026",
            tanggal_arsip: "2026-03-10",
          },
        ],
        pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
  });

  it("meneruskan search, page, dan pageSize ke query", async () => {
    await GET(new NextRequest(`${URL_DASHBOARD}?search=rapat&page=2&pageSize=3`));
    const daftar = mocks.db.$queryRaw.mock.calls.find(
      (p: unknown[]) => !(p[0] as string[]).join("").includes("COUNT(*)"),
    ) as unknown[];
    const [, where, limit, offset] = daftar as [unknown, { values: unknown[] }, number, number];

    expect(where.values).toContain("%rapat%");
    expect({ limit, offset }).toEqual({ limit: 3, offset: 3 });
  });

  it("500 bila database gagal", async () => {
    mocks.db.$queryRaw.mockRejectedValue(new Error("db mati"));
    const res = await GET(new NextRequest(URL_DASHBOARD));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Gagal mengambil data dashboard." });
  });
});
