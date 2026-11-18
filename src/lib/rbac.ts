import type { LocalSessionPayload, SsoRole } from "@/lib/sso";

export type AppRole = SsoRole;

export type RouteAccessDecision =
  | { allowed: true; role: AppRole }
  | { allowed: false; reason: "unauthenticated" | "forbidden"; role: AppRole };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITE_PAGE_SEGMENTS = new Set([
  "tambah",
  "new",
  "create",
  "edit",
  "ubah",
  "hapus",
  "kelola",
]);

export function normalizeRole(role: string | null | undefined): AppRole {
  switch (role) {
    case "Dosen":
    case "Kaprodi":
    case "Admin":
    case "Mahasiswa":
    case "Umum":
      return role;
    default:
      return "Umum";
  }
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function hasPathSegment(pathname: string, segmentSet: Set<string>): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  return segments.some((seg) => segmentSet.has(seg));
}

function isAccPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  return segments.includes("acc") || segments.includes("approve");
}

/**
 * Evaluasi RBAC di tingkat route + HTTP method (dipakai oleh src/proxy.ts).
 * Catatan: kepemilikan baris data ("crud sendiri" vs "view/acc yang lain") tetap
 * wajib dicek di Server Component / Route Handler via getTridharmaPermissions().
 */
export function evaluateRouteRbac(
  pathname: string,
  method: string,
  session: LocalSessionPayload | null
): RouteAccessDecision {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";
  const upperMethod = method.toUpperCase();
  const isRead = READ_METHODS.has(upperMethod);
  const isAcc = isAccPath(pathname);
  const isWriteIntent = !isRead || hasPathSegment(pathname, WRITE_PAGE_SEGMENTS);

  const isTridharma =
    matchesPrefix(pathname, "/tridharma") ||
    matchesPrefix(pathname, "/api/tridharma");

  if (isTridharma) {
    // ACC hanya untuk Kaprodi (menyetujui data dosen lain)
    if (isAcc) {
      if (!isAuthenticated) {
        return { allowed: false, reason: "unauthenticated", role };
      }
      if (role !== "Kaprodi") {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // Mutasi / halaman form tulis hanya untuk Dosen & Kaprodi (milik sendiri dicek di handler)
    if (isWriteIntent) {
      if (!isAuthenticated) {
        return { allowed: false, reason: "unauthenticated", role };
      }
      if (role === "Dosen" || role === "Kaprodi") {
        return { allowed: true, role };
      }
      return { allowed: false, reason: "forbidden", role };
    }

    // View (/tridharma GET) terbuka untuk Dosen, Kaprodi, Admin, Mahasiswa, dan Umum
    return { allowed: true, role };
  }

  const isArsip =
    matchesPrefix(pathname, "/arsip") ||
    matchesPrefix(pathname, "/api/arsip");

  if (isArsip) {
    // Umum (belum login maupun role Umum) dan Mahasiswa ditolak di /arsip
    if (!isAuthenticated) {
      return { allowed: false, reason: "unauthenticated", role };
    }
    if (role === "Mahasiswa" || role === "Umum") {
      return { allowed: false, reason: "forbidden", role };
    }

    // ACC arsip hanya oleh Kaprodi
    if (isAcc) {
      if (role !== "Kaprodi") {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // CRUD arsip hanya oleh Admin
    if (isWriteIntent) {
      if (role !== "Admin") {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // View arsip: Admin, Kaprodi, Dosen
    return { allowed: true, role };
  }

  return { allowed: true, role };
}

/**
 * Helper izin tingkat record untuk modul Tridarma (/tridharma).
 * Pass `ownerDosenId` (single id atau array id anggota pemilik) untuk cek CRUD sendiri vs ACC lain.
 */
export function getTridharmaPermissions(
  session: LocalSessionPayload | null,
  ownerDosenId?: number | number[] | null
) {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";

  const userDosenId = session?.dosen_id ?? null;
  const isOwner =
    isAuthenticated &&
    userDosenId !== null &&
    ownerDosenId !== undefined &&
    ownerDosenId !== null &&
    (Array.isArray(ownerDosenId)
      ? ownerDosenId.includes(userDosenId)
      : ownerDosenId === userDosenId);

  const canWriteOwn =
    isAuthenticated && (role === "Dosen" || role === "Kaprodi");

  return {
    role,
    isAuthenticated,
    isOwner,
    canView: true,
    canCreate: canWriteOwn,
    canUpdate: canWriteOwn && isOwner,
    canDelete: canWriteOwn && isOwner,
    canAcc: isAuthenticated && role === "Kaprodi" && !isOwner,
  };
}

/**
 * Helper izin untuk modul Arsip (/arsip).
 */
export function getArsipPermissions(session: LocalSessionPayload | null) {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";
  const isDenied =
    !isAuthenticated || role === "Mahasiswa" || role === "Umum";

  return {
    role,
    isAuthenticated,
    canView: !isDenied,
    canCreate: isAuthenticated && role === "Admin",
    canUpdate: isAuthenticated && role === "Admin",
    canDelete: isAuthenticated && role === "Admin",
    canAcc: isAuthenticated && role === "Kaprodi",
  };
}
