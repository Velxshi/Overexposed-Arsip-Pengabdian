import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { dosen: { findUnique } } }));

import { cariDosenIdSesi } from "@/lib/dosen-sesi";

const SUB = "92b695bf-8fde-4063-b803-cbbda20bd774";

beforeEach(() => {
  findUnique.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cariDosenIdSesi", () => {
  it.each(["Dosen", "Kaprodi", "Staff Kaprodi", "Admin"])("peran %s: mencari baris dosen lewat user_id", async (peran) => {
    findUnique.mockResolvedValue({ id: 5 });

    expect(await cariDosenIdSesi(SUB, peran)).toBe(5);
    expect(findUnique).toHaveBeenCalledWith({ where: { user_id: SUB }, select: { id: true } });
  });

  it.each(["Mahasiswa", "Umum", "PeranAsing"])("peran %s: langsung null tanpa query", async (peran) => {
    expect(await cariDosenIdSesi(SUB, peran, 9)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("null bila belum ada baris dosen, walau sesi lama punya dosen_id", async () => {
    findUnique.mockResolvedValue(null);
    expect(await cariDosenIdSesi(SUB, "Dosen", 3)).toBeNull();
  });

  it("memakai nilai cadangan bila query gagal", async () => {
    findUnique.mockRejectedValue(new Error("db mati"));
    expect(await cariDosenIdSesi(SUB, "Dosen", 3)).toBe(3);
    expect(await cariDosenIdSesi(SUB, "Dosen")).toBeNull();
  });
});
