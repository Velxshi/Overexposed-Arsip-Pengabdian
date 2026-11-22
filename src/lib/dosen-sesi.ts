import { db } from "@/lib/db";

// Peran yang bisa punya baris dosen (PRD 5.1). Mahasiswa dan Umum tidak pernah punya.
const PERAN_DENGAN_DOSEN = new Set(["Dosen", "Kaprodi", "Staff Kaprodi", "Admin"]);

/**
 * Mencari dosen_id untuk sesi berdasarkan user_id = sub.
 * Bila query gagal, nilai cadangan (dosen_id dari sesi lama) dipakai supaya sesi tidak putus.
 */
export async function cariDosenIdSesi(
  sub: string,
  role: string,
  cadangan: number | null = null,
): Promise<number | null> {
  if (!PERAN_DENGAN_DOSEN.has(role)) return null;

  try {
    const dosen = await db.dosen.findUnique({
      where: { user_id: sub },
      select: { id: true },
    });
    return dosen?.id ?? null;
  } catch (err) {
    console.error("Gagal mencari dosen_id untuk sesi:", err);
    return cadangan;
  }
}
