import { NextRequest } from "next/server";
import type { LocalSessionPayload, SsoRole } from "@/lib/sso";

export const USER_ID = "00000000-0000-4000-8000-000000000009";

export function sesi(role: string): LocalSessionPayload {
  return {
    sub: USER_ID,
    dosen_id: null,
    name: "Pengguna Uji",
    email: "uji@upi.edu",
    nip: null,
    role: role as SsoRole,
    exp: 4102444800,
  };
}

export const PERAN_STAFF = ["Staff Kaprodi", "Admin"] as const;
export const PERAN_NON_STAFF = ["Kaprodi", "Dosen", "Mahasiswa", "Umum"] as const;

export function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

export function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
