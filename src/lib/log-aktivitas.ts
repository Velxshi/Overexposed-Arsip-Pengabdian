import { db } from "@/lib/db";

export type ModulLog = "4" | "7" | "auth";

export type AksiLog =
  | "tambah"
  | "ubah"
  | "hapus"
  | "validasi"
  | "sinkron"
  | "login"
  | "login_gagal";

export type ObjekLog = "arsip" | "kategori" | "dosen" | "sso";

export interface CatatLogInput {
  // Kosong untuk login gagal, karena belum ada akun yang teridentifikasi.
  userId?: string | null;
  userNama?: string | null;
  modul: ModulLog;
  aksi: AksiLog;
  objek: ObjekLog;
  // Pengenal objek (nomor arsip, judul) atau alasan gagal login.
  detail: string;
}

/**
 * Menulis satu baris ke log_aktivitas (PRD 4 dan 6.4).
 * Kegagalan menulis hanya dicatat ke console, supaya operasi utama tidak ikut batal.
 */
export async function catatLog({
  userId,
  userNama,
  modul,
  aksi,
  objek,
  detail,
}: CatatLogInput): Promise<void> {
  try {
    await db.logAktivitas.create({
      data: {
        user_id: userId ?? null,
        user_nama: userNama ?? null,
        modul,
        aksi,
        objek,
        detail,
      },
    });
  } catch (err) {
    console.error(`Gagal mencatat log aktivitas (${modul}/${aksi}/${objek}):`, err);
  }
}
