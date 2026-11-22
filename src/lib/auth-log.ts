import { catatLog } from "@/lib/log-aktivitas";

interface AuthLogInput {
  aksi: "login" | "login_gagal";
  userId?: string | null;
  userName?: string | null;
  detail: string;
}

/** Pintasan catatLog untuk login sukses dan gagal (modul auth, objek sso). */
export async function recordAuthLog({
  aksi,
  userId,
  userName,
  detail,
}: AuthLogInput): Promise<void> {
  await catatLog({
    userId,
    userNama: userName,
    modul: "auth",
    aksi,
    objek: "sso",
    detail,
  });
}
