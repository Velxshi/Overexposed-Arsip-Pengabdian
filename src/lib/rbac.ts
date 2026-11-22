import type { LocalSessionPayload, SsoRole } from "@/lib/sso";

export type AppRole = SsoRole;

export type RouteAccessDecision = { allowed: true; role: AppRole } | { allowed: false; reason: "unauthenticated" | "forbidden"; role: AppRole };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITE_PAGE_SEGMENTS = new Set(["tambah", "new", "create", "edit", "ubah", "hapus", "kelola"]);

export function normalizeRole(role: string | null | undefined): AppRole {
  switch (role) {
    case "Dosen":
    case "Kaprodi":
    case "Staff Kaprodi":
    case "Admin":
    case "Mahasiswa":
    case "Umum":
      return role;
    default:
      return "Umum";
  }
}

export function isStaffKaprodiRole(role: AppRole): boolean {
  return role === "Staff Kaprodi" || role === "Admin";
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function hasPathSegment(pathname: string, segmentSet: Set<string>): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  return segments.some((seg) => segmentSet.has(seg));
}

function isValidasiOrAccPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  return segments.includes("validasi") || segments.includes("acc") || segments.includes("approve");
}

function isKategoriPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  return segments.includes("kategori");
}

function isLogAktivitasPath(pathname: string): boolean {
  return matchesPrefix(pathname, "/api/log-aktivitas") || matchesPrefix(pathname, "/arsip/log-aktivitas");
}

/**
 * Evaluasi RBAC di tingkat route + HTTP method (dipakai oleh src/proxy.ts).
 * Catatan: kepemilikan baris data ("crud sendiri" vs "view/acc yang lain") tetap
 * wajib dicek di Server Component / Route Handler via getTridharmaPermissions().
 */
export function evaluateRouteRbac(pathname: string, method: string, session: LocalSessionPayload | null): RouteAccessDecision {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";
  const upperMethod = method.toUpperCase();
  const isRead = READ_METHODS.has(upperMethod);
  const isAcc = isValidasiOrAccPath(pathname);
  const isWriteIntent = !isRead || hasPathSegment(pathname, WRITE_PAGE_SEGMENTS);

  // 1. Modul 7: /tridharma & /api/tridharma
  const isTridharma = matchesPrefix(pathname, "/tridharma") || matchesPrefix(pathname, "/api/tridharma");

  if (isTridharma) {
    if (isAcc) {
      if (!isAuthenticated) {
        return { allowed: false, reason: "unauthenticated", role };
      }
      if (role !== "Kaprodi") {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    if (isWriteIntent) {
      if (!isAuthenticated) {
        return { allowed: false, reason: "unauthenticated", role };
      }
      if (role === "Dosen" || role === "Kaprodi") {
        return { allowed: true, role };
      }
      return { allowed: false, reason: "forbidden", role };
    }

    // View (/tridharma GET) terbuka untuk semua peran termasuk Mahasiswa & Umum
    return { allowed: true, role };
  }

  // 2. Endpoint sinkronisasi & profil dosen (PRD 5.1 & 8.1)
  if (matchesPrefix(pathname, "/api/staff-kaprodi")) {
    if (!isAuthenticated) {
      return { allowed: false, reason: "unauthenticated", role };
    }
    if (!isStaffKaprodiRole(role)) {
      return { allowed: false, reason: "forbidden", role };
    }
    return { allowed: true, role };
  }

  if (matchesPrefix(pathname, "/api/dosen")) {
    if (!isAuthenticated) {
      return { allowed: false, reason: "unauthenticated", role };
    }
    if (role === "Dosen" || role === "Kaprodi" || isStaffKaprodiRole(role)) {
      return { allowed: true, role };
    }
    return { allowed: false, reason: "forbidden", role };
  }

  // 3. Log aktivitas (PRD 6.1 & 6.4): hanya Staff Kaprodi dan Kaprodi (baca saja)
  if (isLogAktivitasPath(pathname)) {
    if (!isAuthenticated) {
      return { allowed: false, reason: "unauthenticated", role };
    }
    if (!isRead) {
      return { allowed: false, reason: "forbidden", role };
    }
    if (isStaffKaprodiRole(role) || role === "Kaprodi") {
      return { allowed: true, role };
    }
    return { allowed: false, reason: "forbidden", role };
  }

  // 4. Modul 4: /arsip, /api/arsip, & /api/dashboard (PRD 6.1)
  const isArsip = matchesPrefix(pathname, "/arsip") || matchesPrefix(pathname, "/api/arsip") || matchesPrefix(pathname, "/api/dashboard");

  if (isArsip) {
    if (!isAuthenticated) {
      return { allowed: false, reason: "unauthenticated", role };
    }
    if (role === "Mahasiswa" || role === "Umum") {
      return { allowed: false, reason: "forbidden", role };
    }

    // Halaman & API Validasi Arsip: khusus Kaprodi (PRD 6.1 & 6.3)
    if (isAcc) {
      if (role !== "Kaprodi") {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // Kategori Arsip: Staff Kaprodi CRUD, Kaprodi baca, Dosen ditolak (PRD 6.1)
    if (isKategoriPath(pathname)) {
      if (role === "Dosen") {
        return { allowed: false, reason: "forbidden", role };
      }
      if (isWriteIntent && !isStaffKaprodiRole(role)) {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // Tulis (tambah, ubah, hapus arsip): hanya Staff Kaprodi / Admin (PRD 6.1)
    if (isWriteIntent) {
      if (!isStaffKaprodiRole(role)) {
        return { allowed: false, reason: "forbidden", role };
      }
      return { allowed: true, role };
    }

    // Daftar Arsip & Dashboard (GET): Staff Kaprodi, Kaprodi, Dosen
    return { allowed: true, role };
  }

  return { allowed: true, role };
}

/**
 * Helper izin tingkat record untuk modul Tridarma (/tridharma).
 * Pass `ownerDosenId` (single id atau array id anggota pemilik) untuk cek CRUD sendiri vs ACC lain.
 */
export function getTridharmaPermissions(session: LocalSessionPayload | null, ownerDosenId?: number | number[] | null) {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";

  const userDosenId = session?.dosen_id ?? null;
  const isOwner = isAuthenticated && userDosenId !== null && ownerDosenId !== undefined && ownerDosenId !== null && (Array.isArray(ownerDosenId) ? ownerDosenId.includes(userDosenId) : ownerDosenId === userDosenId);

  const canWriteOwn = isAuthenticated && (role === "Dosen" || role === "Kaprodi");

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
 * Helper izin untuk modul Arsip (/arsip) sesuai PRD v1.5 bagian 6.1 & 6.4.
 */
export function getArsipPermissions(session: LocalSessionPayload | null) {
  const isAuthenticated = session !== null;
  const role: AppRole = isAuthenticated ? normalizeRole(session.role) : "Umum";
  const isDenied = !isAuthenticated || role === "Mahasiswa" || role === "Umum";
  const staffKaprodi = isAuthenticated && isStaffKaprodiRole(role);
  const kaprodi = isAuthenticated && role === "Kaprodi";

  return {
    role,
    isAuthenticated,
    canViewArsip: !isDenied,
    canViewKategori: staffKaprodi || kaprodi,
    canViewLogAktivitas: staffKaprodi || kaprodi,
    canManageArsip: staffKaprodi,
    canManageKategori: staffKaprodi,
    canValidate: kaprodi,
    canAcc: kaprodi,
  };
}
