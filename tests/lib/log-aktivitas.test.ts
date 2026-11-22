import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { logAktivitas: { create } },
}));

import { recordAuthLog } from "@/lib/auth-log";
import { catatLog } from "@/lib/log-aktivitas";

const USER_ID = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catatLog", () => {
  it("menulis baris log dengan semua kolom", async () => {
    await catatLog({
      userId: USER_ID,
      userNama: "Staff Kaprodi",
      modul: "4",
      aksi: "tambah",
      objek: "arsip",
      detail: "ARS-001",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: USER_ID,
        user_nama: "Staff Kaprodi",
        modul: "4",
        aksi: "tambah",
        objek: "arsip",
        detail: "ARS-001",
      },
    });
  });

  it("login gagal tanpa userId: user_id dan user_nama null, alasan masuk ke detail", async () => {
    await catatLog({
      modul: "auth",
      aksi: "login_gagal",
      objek: "sso",
      detail: "Parameter state callback SSO tidak cocok.",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: null,
        user_nama: null,
        modul: "auth",
        aksi: "login_gagal",
        objek: "sso",
        detail: "Parameter state callback SSO tidak cocok.",
      },
    });
  });

  it("userId dan userNama null eksplisit tetap ditulis sebagai null", async () => {
    await catatLog({
      userId: null,
      userNama: null,
      modul: "auth",
      aksi: "login_gagal",
      objek: "sso",
      detail: "Cookie sso_tx tidak ditemukan.",
    });

    const { data } = create.mock.calls[0][0];
    expect(data.user_id).toBeNull();
    expect(data.user_nama).toBeNull();
  });

  it("meneruskan modul, aksi, dan objek untuk modul 7", async () => {
    await catatLog({
      userId: USER_ID,
      userNama: "Dosen",
      modul: "7",
      aksi: "sinkron",
      objek: "dosen",
      detail: "sinta_id 6658552: SUCCESS",
    });

    const { data } = create.mock.calls[0][0];
    expect(data.modul).toBe("7");
    expect(data.aksi).toBe("sinkron");
    expect(data.objek).toBe("dosen");
  });

  describe("kegagalan menulis log", () => {
    it("tidak melempar galat dan tidak membatalkan operasi utama", async () => {
      const galat = new Error("koneksi putus");
      create.mockRejectedValue(galat);
      const konsol = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        catatLog({
          userId: USER_ID,
          userNama: "Kaprodi",
          modul: "4",
          aksi: "validasi",
          objek: "arsip",
          detail: "ARS-002",
        }),
      ).resolves.toBeUndefined();

      expect(konsol).toHaveBeenCalledTimes(1);
      expect(konsol.mock.calls[0][0]).toContain("4/validasi/arsip");
      expect(konsol.mock.calls[0][1]).toBe(galat);
    });

    it("login gagal tetap tidak melempar galat saat database mati", async () => {
      create.mockRejectedValue(new Error("db mati"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        catatLog({
          modul: "auth",
          aksi: "login_gagal",
          objek: "sso",
          detail: "alasan",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("recordAuthLog", () => {
  it("login sukses dicatat sebagai modul auth, objek sso", async () => {
    await recordAuthLog({
      aksi: "login",
      userId: USER_ID,
      userName: "Dosen Uji",
      detail: "Login berhasil dengan role Dosen",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: USER_ID,
        user_nama: "Dosen Uji",
        modul: "auth",
        aksi: "login",
        objek: "sso",
        detail: "Login berhasil dengan role Dosen",
      },
    });
  });

  it("login gagal tanpa userId dan userName menghasilkan null", async () => {
    await recordAuthLog({
      aksi: "login_gagal",
      detail: "Penukaran token SSO gagal (HTTP 401, invalid_grant)",
    });

    const { data } = create.mock.calls[0][0];
    expect(data.user_id).toBeNull();
    expect(data.user_nama).toBeNull();
    expect(data.modul).toBe("auth");
    expect(data.aksi).toBe("login_gagal");
    expect(data.detail).toContain("invalid_grant");
  });
});
