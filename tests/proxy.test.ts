import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { dosen: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/sso", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/sso")>();
  return {
    ...asli,
    decryptRefreshToken: mocks.decrypt,
    encryptRefreshToken: mocks.encrypt,
    refreshWithSsoSingleFlight: mocks.refresh,
  };
});

import { signLocalSession, verifyLocalSession } from "@/lib/sso";
import { proxy } from "@/proxy";

const SUB = "92b695bf-8fde-4063-b803-cbbda20bd774";
const detik = () => Math.floor(Date.now() / 1000);

async function tokenSesi(dosenId: number | null, exp: number, role = "Dosen") {
  return signLocalSession(
    { sub: SUB, dosen_id: dosenId, name: "Dosen Uji", email: "dosen@upi.edu", nip: null, role: role as "Dosen" },
    exp,
  );
}

function permintaan(cookies: Record<string, string>) {
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest("http://localhost:3000/api/me", { headers: { cookie: header } });
}

async function dosenIdDiCookieBaru(res: Response & { cookies: { get(n: string): { value: string } | undefined } }) {
  const token = res.cookies.get("app_session")?.value;
  if (!token) return "tidak ada cookie baru";
  return (await verifyLocalSession(token))?.dosen_id;
}

beforeAll(() => {
  process.env.SESSION_SECRET = "rahasia-khusus-tes-proxy-minimal-32-karakter";
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.decrypt.mockResolvedValue("refresh-lama");
  mocks.encrypt.mockResolvedValue("refresh-baru-terenkripsi");
  mocks.refresh.mockResolvedValue({
    ok: true,
    payload: { sub: SUB, name: "Dosen Uji", email: "dosen@upi.edu", nip: null, role: "Dosen", exp: detik() + 900 },
    refreshToken: "refresh-baru",
  });
});

describe("proxy: penyegaran sesi mengambil dosen_id terbaru", () => {
  it("sesi lama dosen_id null, baris dosen sudah ada: sesi baru berisi dosen_id", async () => {
    mocks.findUnique.mockResolvedValue({ id: 5 });
    const kedaluwarsa = await tokenSesi(null, detik() - 60);

    const res = await proxy(permintaan({ app_session: kedaluwarsa, sso_refresh: "x" }));

    expect(mocks.refresh).toHaveBeenCalledWith("refresh-lama");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { user_id: SUB }, select: { id: true } });
    expect(await dosenIdDiCookieBaru(res as never)).toBe(5);
  });

  it("cookie app_session sudah hilang: dosen_id tetap diisi dari database", async () => {
    mocks.findUnique.mockResolvedValue({ id: 7 });
    const res = await proxy(permintaan({ sso_refresh: "x" }));
    expect(await dosenIdDiCookieBaru(res as never)).toBe(7);
  });

  it("baris dosen dihapus: dosen_id menjadi null walau sesi lama berisi angka", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const kedaluwarsa = await tokenSesi(3, detik() - 60);

    const res = await proxy(permintaan({ app_session: kedaluwarsa, sso_refresh: "x" }));

    expect(await dosenIdDiCookieBaru(res as never)).toBeNull();
  });

  it("database gagal: memakai dosen_id dari sesi lama", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db mati"));
    const kedaluwarsa = await tokenSesi(3, detik() - 60);

    const res = await proxy(permintaan({ app_session: kedaluwarsa, sso_refresh: "x" }));

    expect(await dosenIdDiCookieBaru(res as never)).toBe(3);
  });

  it("peran Mahasiswa: tidak query dan dosen_id null", async () => {
    mocks.refresh.mockResolvedValue({
      ok: true,
      payload: { sub: SUB, name: "Mhs", email: "m@upi.edu", nip: null, role: "Mahasiswa", exp: detik() + 900 },
      refreshToken: "refresh-baru",
    });

    const res = await proxy(permintaan({ sso_refresh: "x" }));

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(await dosenIdDiCookieBaru(res as never)).toBeNull();
  });

  it("sesi masih berlaku: tidak refresh dan tidak query database", async () => {
    const aktif = await tokenSesi(null, detik() + 600);

    const res = await proxy(permintaan({ app_session: aktif, sso_refresh: "x" }));

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(await dosenIdDiCookieBaru(res as never)).toBe("tidak ada cookie baru");
  });
});
