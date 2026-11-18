import { cookies } from "next/headers";
import {
  SSO_SESSION_COOKIE,
  verifyLocalSession,
  type LocalSessionPayload,
} from "@/lib/sso";

export type { LocalSessionPayload };

export async function getSession(): Promise<LocalSessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SSO_SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;

  return verifyLocalSession(sessionCookie);
}
