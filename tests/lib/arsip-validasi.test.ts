import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, count, findUnique, update, createLog, getSessionMock } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  createLog: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arsip: {
      findMany,
      count,
      findUnique,
      update,
    },
    logAktivitas: {
      create: createLog,
    },
  },
}));

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}));

import { PATCH as patchValidasiArsip } from "@/app/api/arsip/[id]/validasi/route";
import { GET as getValidasiArsipList } from "@/app/api/arsip/validasi/route";
import { parseArsipValidasiFilters, parseValidasiArsipPayload } from "@/lib/arsip";

const KAPRODI_SESSION = {
  sub: "00000000-0000-4000-8000-000000000001",
  dosen_id: 1,
  name: "Kaprodi RPL",
  email: "kaprodi@upi.edu",
  nip: "198001012005011001",
  role: "Kaprodi" as const,
  exp: Math.floor(Date.now() / 1000) + 900,
};

const STAFF_SESSION = {
  ...KAPRODI_SESSION,
  sub: "00000000-0000-4000-8000-000000000002",
  name: "Staff Kaprodi",
  role: "Staff Kaprodi" as const,
};

const DOSEN_SESSION = {
  ...KAPRODI_SESSION,
  sub: "00000000-0000-4000-8000-000000000003",
  name: "Dosen RPL",
  role: "Dosen" as const,
};

const MAHASISWA_SESSION = {
  ...KAPRODI_SESSION,
  sub: "00000000-0000-4000-8000-000000000004",
  dosen_id: null,
  name: "Mahasiswa RPL",
  role: "Mahasiswa" as const,
};

function sampleArsipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    nomor_arsip: "ARS-2026-010",
    nomor_surat: "010/RPL/2026",
    judul: "SK Kurikulum",
    kategori_id: 1,
    tanggal_arsip: new Date("2026-01-15T00:00:00.000Z"),
    pencipta_unit: "Prodi RPL",
    retensi_aktif_tahun: 2,
    retensi_inaktif_tahun: 3,
    link_berkas: "https://drive.google.com/file/d/10",
    keterangan: null,
    status_validasi: "Pending",
    catatan_validasi: null,
    dibuat_oleh: STAFF_SESSION.sub,
    created_at: new Date("2026-01-15T00:00:00.000Z"),
    updated_at: new Date("2026-01-15T00:00:00.000Z"),
    kategori: {
      id: 1,
      kode: "ADM",
      nama: "Arsip Administrasi",
    },
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
  findUnique.mockReset();
  update.mockReset();
  createLog.mockReset();
  getSessionMock.mockReset();
  createLog.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseValidasiArsipPayload", () => {
  it("menerima status Diterima tanpa catatan_validasi (null)", () => {
    const res = parseValidasiArsipPayload({ status_validasi: "Diterima" });
    expect(res).toEqual({
      ok: true,
      data: {
        status_validasi: "Diterima",
        catatan_validasi: null,
      },
    });
  });

  it("menerima status Diterima dengan catatan_validasi opsional", () => {
    const res = parseValidasiArsipPayload({
      status_validasi: "Diterima",
      catatan_validasi: "  Dokumen lengkap  ",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        status_validasi: "Diterima",
        catatan_validasi: "Dokumen lengkap",
      },
    });
  });

  it("menolak status Ditolak bila catatan_validasi kosong", () => {
    expect(parseValidasiArsipPayload({ status_validasi: "Ditolak" }).ok).toBe(false);
    expect(parseValidasiArsipPayload({ status_validasi: "Ditolak", catatan_validasi: "   " }).ok).toBe(false);
  });

  it("menerima status Ditolak bila catatan_validasi diisi", () => {
    const res = parseValidasiArsipPayload({
      status_validasi: "Ditolak",
      catatan_validasi: "Nomor surat tidak sesuai",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        status_validasi: "Ditolak",
        catatan_validasi: "Nomor surat tidak sesuai",
      },
    });
  });

  it("menolak status Pending atau nilai tidak dikenal", () => {
    expect(parseValidasiArsipPayload({ status_validasi: "Pending" }).ok).toBe(false);
    expect(parseValidasiArsipPayload({ status_validasi: "Disetujui" }).ok).toBe(false);
  });
});

describe("parseArsipValidasiFilters", () => {
  it("memvalidasi filter status Pending, Diterima, dan Ditolak", () => {
    for (const status of ["Pending", "Diterima", "Ditolak"] as const) {
      const res = parseArsipValidasiFilters(new URLSearchParams({ status, page: "2", pageSize: "15" }));
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.filters.status).toBe(status);
        expect(res.filters.page).toBe(2);
        expect(res.filters.pageSize).toBe(15);
        expect(res.where).toEqual({ status_validasi: status });
      }
    }
  });

  it("menolak nilai status yang tidak valid", () => {
    const res = parseArsipValidasiFilters(new URLSearchParams({ status: "Invalid" }));
    expect(res.ok).toBe(false);
  });
});

describe("GET /api/arsip/validasi", () => {
  it("menolak akses bila belum login (401)", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const unauthRes = await getValidasiArsipList(new NextRequest("http://localhost/api/arsip/validasi?status=Pending"));
    expect(unauthRes.status).toBe(401);
  });

  it("mengembalikan 403 untuk Staff Kaprodi, Dosen, dan Mahasiswa", async () => {
    for (const session of [STAFF_SESSION, DOSEN_SESSION, MAHASISWA_SESSION]) {
      getSessionMock.mockResolvedValueOnce(session);
      const res = await getValidasiArsipList(new NextRequest("http://localhost/api/arsip/validasi?status=Pending"));
      expect(res.status).toBe(403);
    }
  });

  it("mengembalikan daftar arsip sesuai status dengan pagination untuk Kaprodi", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    findMany.mockResolvedValueOnce([sampleArsipRow({ status_validasi: "Pending" })]);
    count.mockResolvedValueOnce(1);

    const res = await getValidasiArsipList(new NextRequest("http://localhost/api/arsip/validasi?status=Pending&page=1&pageSize=10"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status_validasi: "Pending" },
        skip: 0,
        take: 10,
      }),
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status_validasi).toBe("Pending");
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
  });
});

describe("PATCH /api/arsip/[id]/validasi", () => {
  const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

  it("mengembalikan 403 untuk Staff Kaprodi, Dosen, dan Mahasiswa", async () => {
    for (const session of [STAFF_SESSION, DOSEN_SESSION, MAHASISWA_SESSION]) {
      getSessionMock.mockResolvedValueOnce(session);
      const req = new NextRequest("http://localhost/api/arsip/10/validasi", {
        method: "PATCH",
        body: JSON.stringify({ status_validasi: "Diterima" }),
      });
      const res = await patchValidasiArsip(req, makeContext("10"));
      expect(res.status).toBe(403);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("mengubah status arsip dari Pending ke Diterima dengan catatan_validasi opsional dikosongkan dan mencatat log", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    findUnique.mockResolvedValueOnce({ id: 10, status_validasi: "Pending" });
    update.mockResolvedValueOnce(sampleArsipRow({ status_validasi: "Diterima", catatan_validasi: null }));

    const req = new NextRequest("http://localhost/api/arsip/10/validasi", {
      method: "PATCH",
      body: JSON.stringify({ status_validasi: "Diterima" }),
    });
    const res = await patchValidasiArsip(req, makeContext("10"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status_validasi).toBe("Diterima");
    expect(body.data.catatan_validasi).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: {
          status_validasi: "Diterima",
          catatan_validasi: null,
        },
      }),
    );
    expect(createLog).toHaveBeenCalledWith({
      data: {
        user_id: KAPRODI_SESSION.sub,
        user_nama: KAPRODI_SESSION.name,
        modul: "4",
        aksi: "validasi",
        objek: "arsip",
        detail: "ARS-2026-010 - SK Kurikulum (Diterima)",
      },
    });
  });

  it("mengubah status arsip dari Pending ke Ditolak dengan catatan_validasi wajib dan mencatat log", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    findUnique.mockResolvedValueOnce({ id: 10, status_validasi: "Pending" });
    update.mockResolvedValueOnce(
      sampleArsipRow({
        status_validasi: "Ditolak",
        catatan_validasi: "Format nomor surat belum sesuai pedoman",
      }),
    );

    const req = new NextRequest("http://localhost/api/arsip/10/validasi", {
      method: "PATCH",
      body: JSON.stringify({
        status_validasi: "Ditolak",
        catatan_validasi: "Format nomor surat belum sesuai pedoman",
      }),
    });
    const res = await patchValidasiArsip(req, makeContext("10"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status_validasi).toBe("Ditolak");
    expect(body.data.catatan_validasi).toBe("Format nomor surat belum sesuai pedoman");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: {
          status_validasi: "Ditolak",
          catatan_validasi: "Format nomor surat belum sesuai pedoman",
        },
      }),
    );
    expect(createLog).toHaveBeenCalledWith({
      data: {
        user_id: KAPRODI_SESSION.sub,
        user_nama: KAPRODI_SESSION.name,
        modul: "4",
        aksi: "validasi",
        objek: "arsip",
        detail: "ARS-2026-010 - SK Kurikulum (Ditolak)",
      },
    });
  });

  it("mengizinkan arsip yang sudah Diterima untuk ditolak ulang (Ditolak) dengan catatan wajib", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    findUnique.mockResolvedValueOnce({ id: 10, status_validasi: "Diterima" });
    update.mockResolvedValueOnce(
      sampleArsipRow({
        status_validasi: "Ditolak",
        catatan_validasi: "Lampiran belum ditandatangani",
      }),
    );

    const req = new NextRequest("http://localhost/api/arsip/10/validasi", {
      method: "PATCH",
      body: JSON.stringify({
        status_validasi: "Ditolak",
        catatan_validasi: "Lampiran belum ditandatangani",
      }),
    });
    const res = await patchValidasiArsip(req, makeContext("10"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status_validasi).toBe("Ditolak");
    expect(body.data.catatan_validasi).toBe("Lampiran belum ditandatangani");
  });

  it("menolak PATCH Ditolak tanpa catatan_validasi dengan status 400", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    const reqNoNote = new NextRequest("http://localhost/api/arsip/10/validasi", {
      method: "PATCH",
      body: JSON.stringify({ status_validasi: "Ditolak" }),
    });
    const resNoNote = await patchValidasiArsip(reqNoNote, makeContext("10"));
    expect(resNoNote.status).toBe(400);

    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    const reqBlankNote = new NextRequest("http://localhost/api/arsip/10/validasi", {
      method: "PATCH",
      body: JSON.stringify({ status_validasi: "Ditolak", catatan_validasi: "   " }),
    });
    const resBlankNote = await patchValidasiArsip(reqBlankNote, makeContext("10"));
    expect(resBlankNote.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("mengembalikan 404 bila arsip tidak ditemukan", async () => {
    getSessionMock.mockResolvedValueOnce(KAPRODI_SESSION);
    findUnique.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost/api/arsip/999/validasi", {
      method: "PATCH",
      body: JSON.stringify({ status_validasi: "Diterima" }),
    });
    const res = await patchValidasiArsip(req, makeContext("999"));
    expect(res.status).toBe(404);
  });
});
