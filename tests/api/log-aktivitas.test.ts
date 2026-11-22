import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sesi } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: { logAktivitas: { findMany: vi.fn(), count: vi.fn() } },
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET } from "@/app/api/log-aktivitas/route";

const URL_LOG = "http://localhost/api/log-aktivitas";
const LOG = {
  id: 20,
  user_id: null,
  user_nama: null,
  modul: "auth",
  aksi: "login_gagal",
  objek: "sso",
  detail: "Parameter state callback SSO tidak cocok.",
  created_at: new Date("2026-11-21T08:00:00.000Z"),
};

const panggil = (query = "") => GET(new NextRequest(`${URL_LOG}${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(sesi("Kaprodi"));
  mocks.db.logAktivitas.findMany.mockResolvedValue([LOG]);
  mocks.db.logAktivitas.count.mockResolvedValue(1);
});

describe("GET /api/log-aktivitas", () => {
  it("401 tanpa sesi", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await panggil();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Silakan login terlebih dahulu." });
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
    const res = await panggil();

    expect(res.status).toBe(status);
    if (status === 403) {
      expect(await res.json()).toEqual({ message: "Anda tidak memiliki izin untuk melihat log aktivitas." });
      expect(mocks.db.logAktivitas.findMany).not.toHaveBeenCalled();
    }
  });

  it("mengembalikan item dan pagination", async () => {
    const res = await panggil();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      items: [{ ...LOG, created_at: "2026-11-21T08:00:00.000Z" }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it("meneruskan filter modul, aksi, objek, dan rentang tanggal", async () => {
    await panggil("?modul=4&aksi=validasi&objek=arsip&dari=2026-11-01&sampai=2026-11-21");
    expect(mocks.db.logAktivitas.findMany.mock.calls[0][0].where).toEqual({
      modul: "4",
      aksi: "validasi",
      objek: "arsip",
      created_at: {
        gte: new Date("2026-10-31T17:00:00.000Z"),
        lt: new Date("2026-11-21T17:00:00.000Z"),
      },
    });
  });

  it("menerapkan pagination dan urutan terbaru di atas", async () => {
    mocks.db.logAktivitas.count.mockResolvedValue(45);
    const res = await panggil("?page=2&pageSize=20");
    const args = mocks.db.logAktivitas.findMany.mock.calls[0][0];

    expect(args).toMatchObject({ skip: 20, take: 20, orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    expect((await res.json()).pagination).toEqual({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
  });

  it.each([
    ["modul tidak dikenal", "?modul=9"],
    ["aksi tidak dikenal", "?aksi=hapus_semua"],
    ["objek tidak dikenal", "?objek=user"],
    ["tanggal tidak valid", "?dari=2026-02-30"],
    ["rentang terbalik", "?dari=2026-11-22&sampai=2026-11-21"],
  ])("400 untuk %s, tanpa query ke database", async (_nama, query) => {
    const res = await panggil(query);
    expect(res.status).toBe(400);
    expect(Object.keys(await res.json())).toEqual(["message"]);
    expect(mocks.db.logAktivitas.findMany).not.toHaveBeenCalled();
  });

  it("500 bila database gagal", async () => {
    mocks.db.logAktivitas.findMany.mockRejectedValue(new Error("db mati"));
    const res = await panggil();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Gagal mengambil log aktivitas." });
  });
});
