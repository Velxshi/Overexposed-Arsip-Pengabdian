"use client";

import { useRouter } from "next/navigation";
import React, { useId, useState } from "react";
import type { LocalSessionPayload, SsoRole } from "@/lib/sso";

interface DevLoginPanelProps {
  isDevEnabled: boolean;
  currentSession: LocalSessionPayload | null;
}

const ROLE_OPTIONS: Array<{
  role: SsoRole;
  label: string;
  permissionSummary: string;
}> = [
  {
    role: "Dosen",
    label: "Dosen",
    permissionSummary:
      "Tridarma: CRUD milik sendiri, view dosen lain. Arsip: view saja.",
  },
  {
    role: "Kaprodi",
    label: "Kaprodi",
    permissionSummary:
      "Tridarma: CRUD milik sendiri, ACC data lain. Arsip: view dan ACC.",
  },
  {
    role: "Admin",
    label: "Admin",
    permissionSummary: "Tridarma: view saja. Arsip: CRUD penuh.",
  },
  {
    role: "Mahasiswa",
    label: "Mahasiswa",
    permissionSummary: "Tridarma: view saja. Arsip: ditolak (403).",
  },
  {
    role: "Umum",
    label: "Umum",
    permissionSummary: "Tridarma: view saja. Arsip: ditolak (403).",
  },
];

export function DevLoginPanel({
  isDevEnabled,
  currentSession,
}: DevLoginPanelProps) {
  const router = useRouter();
  const destinationSelectId = useId();
  const [selectedRole, setSelectedRole] = useState<SsoRole>(
    currentSession?.role ?? "Dosen"
  );
  const [destination, setDestination] = useState<string>("/login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDevLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({
        role: selectedRole,
        next: destination,
        mode: "json",
      });
      const res = await fetch(`/api/dev-login?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });

      const body = (await res.json().catch(() => null)) as {
        error?: string;
        redirectPath?: string;
      } | null;

      if (!res.ok) {
        setErrorMessage(
          body?.error ?? "Gagal masuk menggunakan rute dev-login."
        );
        return;
      }

      const target = body?.redirectPath ?? destination;
      if (target === "/login") {
        router.refresh();
      } else {
        router.push(target);
      }
    } catch {
      setErrorMessage(
        "Tidak dapat menghubungi server. Periksa apakah server Next.js berjalan."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Status sesi aktif jika sudah login */}
      {currentSession ? (
        <section
          aria-label="Sesi aktif saat ini"
          className="rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="inline-flex w-fit items-center rounded-[6px] bg-[var(--color-success-bg)] px-2.5 py-0.5 text-[11px] font-bold tracking-[0.44px] text-[var(--color-success-text)]">
                Sesi Aktif
              </span>
              <p className="font-[family-name:var(--font-lexend)] text-[16px] font-semibold text-[var(--color-text-primary)]">
                {currentSession.name}
              </p>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Role:{" "}
                <strong className="text-[var(--color-text-ink)]">
                  {currentSession.role}
                </strong>{" "}
                | Email: {currentSession.email}
                {currentSession.dosen_id !== null
                  ? ` | Dosen ID: ${currentSession.dosen_id}`
                  : ""}
              </p>
            </div>

            <a
              href="/sso/logout"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)]"
            >
              Keluar
            </a>
          </div>
        </section>
      ) : null}

      {/* Login utama via SSO SACIBIRU */}
      <section aria-label="Login SSO SACIBIRU" className="flex flex-col gap-3">
        <a
          href="/sso/login"
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-[var(--color-primary)] px-5 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[var(--color-primary-strong)]"
        >
          Masuk dengan SSO SACIBIRU
        </a>
        <p className="text-center text-[12px] leading-[18px] text-[var(--color-text-muted)]">
          Autentikasi resmi Program Studi RPL UPI Kampus Cibiru.
        </p>
      </section>

      {/* Form Dev Login (/api/dev-login) */}
      <section
        aria-label="Login pengujian lokal"
        className="border-t border-[var(--color-border-default)] pt-6"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-lexend)] text-[16px] font-bold text-[var(--color-text-primary)]">
            Login Pengujian Lokal
          </h2>
          <span className="rounded-[6px] bg-[var(--color-tint-accent)] px-2.5 py-1 text-[11px] font-bold tracking-[0.44px] text-[var(--color-warning-text)]">
            {isDevEnabled ? "Mode Dev (/api/dev-login)" : "Nonaktif di Production"}
          </span>
        </div>

        {!isDevEnabled ? (
          <p className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-tint-neutral)] p-4 text-[13px] leading-[20px] text-[var(--color-text-secondary)]">
            Rute <code>/api/dev-login</code> dinonaktifkan di lingkungan production. Gunakan tombol SSO SACIBIRU di atas untuk masuk.
          </p>
        ) : (
          <form onSubmit={handleDevLogin} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-1 text-[13px] font-semibold text-[var(--color-text-secondary)]">
                Pilih peran akun pengujian
              </legend>

              {ROLE_OPTIONS.map((option) => {
                const isSelected = selectedRole === option.role;
                return (
                  <label
                    key={option.role}
                    className={`flex min-h-[52px] items-start gap-3 rounded-[12px] border p-3.5 transition-colors ${
                      isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-tint-primary)]/50"
                        : "border-[var(--color-border-default)] bg-white hover:bg-[var(--color-bg-page)]/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={option.role}
                      checked={isSelected}
                      onChange={() => setSelectedRole(option.role)}
                      className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-bold text-[var(--color-text-primary)]">
                        {option.label}
                      </span>
                      <span className="text-[12px] leading-[17px] text-[var(--color-text-secondary)]">
                        {option.permissionSummary}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={destinationSelectId}
                className="text-[12px] font-semibold text-[var(--color-text-secondary)]"
              >
                Tujuan setelah login
              </label>
              <select
                id={destinationSelectId}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="min-h-[44px] w-full rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-text-ink)]"
              >
                <option value="/login">
                  Tetap di /login (lihat status sesi aktif)
                </option>
                <option value="/">Beranda (/)</option>
                <option value="/tridharma">
                  /tridharma (rute modul Tridarma)
                </option>
                <option value="/arsip">/arsip (rute modul Arsip)</option>
              </select>
            </div>

            {errorMessage ? (
              <div
                role="alert"
                className="rounded-[10px] bg-[var(--color-danger-bg)] px-4 py-3 text-[13px] font-medium text-[var(--color-danger-solid)]"
              >
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-[var(--color-text-primary)] px-5 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[var(--color-primary-strong)] disabled:opacity-60"
            >
              {isSubmitting
                ? "Memproses login..."
                : `Masuk sebagai ${selectedRole}`}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
