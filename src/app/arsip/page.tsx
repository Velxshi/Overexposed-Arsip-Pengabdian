import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getArsipPermissions } from "@/lib/rbac";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Arsip | Sistem Informasi RPL",
  description: "Halaman pengujian RBAC modul Arsip Program Studi.",
};

function PermissionItem({
  label,
  allowed,
}: {
  label: string;
  allowed: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-border-default)] bg-white px-4 py-3 text-[13px]">
      <span className="font-medium text-[var(--color-text-primary)]">
        {label}
      </span>
      <span
        className={`rounded-[6px] px-2.5 py-1 text-[11px] font-bold tracking-[0.44px] ${
          allowed
            ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
            : "bg-[var(--color-tint-neutral)] text-[var(--color-text-secondary)]"
        }`}
      >
        {allowed ? "Diizinkan" : "Ditolak"}
      </span>
    </li>
  );
}

async function ArsipContent() {
  const session = await getSession();
  if (!session) {
    redirect("/sso/login");
  }

  const perms = getArsipPermissions(session);
  if (!perms.canView) {
    redirect("/akses-ditolak");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] p-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.6px] text-[var(--color-text-secondary)]">
          Status Akses Anda
        </p>
        <p className="mt-1 font-[family-name:var(--font-lexend)] text-[18px] font-bold text-[var(--color-text-primary)]">
          Role: {perms.role}
        </p>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Masuk sebagai {session.name} ({session.email})
        </p>
      </div>

      <div>
        <h2 className="mb-2.5 font-[family-name:var(--font-lexend)] text-[15px] font-bold text-[var(--color-text-primary)]">
          Izin RBAC Modul Arsip
        </h2>
        <ul className="flex flex-col gap-2">
          <PermissionItem
            label="Lihat daftar & detail Arsip (View)"
            allowed={perms.canView}
          />
          <PermissionItem
            label="Tambah, Edit, dan Hapus Arsip (CRUD)"
            allowed={perms.canCreate && perms.canUpdate && perms.canDelete}
          />
          <PermissionItem
            label="ACC / Persetujuan Arsip"
            allowed={perms.canAcc}
          />
        </ul>
      </div>

      <nav
        aria-label="Navigasi pengujian"
        className="flex flex-wrap gap-3 border-t border-[var(--color-border-default)] pt-4"
      >
        <Link
          href="/tridharma"
          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-[var(--color-primary-strong)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)]"
        >
          Ke /tridharma
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)]"
        >
          Ganti Role (/login)
        </Link>
        <a
          href="/sso/logout"
          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)]"
        >
          Keluar
        </a>
      </nav>
    </div>
  );
}

export default function ArsipPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-[var(--color-bg-page)] px-4 py-10">
      <div className="my-auto w-full max-w-[560px] rounded-[18px] bg-[var(--color-bg-surface)] p-6 shadow-[0px_4px_20px_rgba(11,42,76,0.06)] sm:p-8">
        <header className="mb-5">
          <p className="text-[12px] font-bold uppercase tracking-[0.6px] text-[var(--color-primary-strong)]">
            Modul 4
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-lexend)] text-[28px] font-bold leading-[32px] text-[var(--color-text-primary)]">
            Arsip
          </h1>
        </header>

        <Suspense
          fallback={
            <p role="status" className="text-[13px] text-[var(--color-text-muted)]">
              Memeriksa sesi dan izin RBAC...
            </p>
          }
        >
          <ArsipContent />
        </Suspense>
      </div>
    </main>
  );
}
