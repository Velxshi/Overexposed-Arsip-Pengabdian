import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DevLoginPanel } from "@/components/DevLoginPanel";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Masuk | Sistem Informasi RPL",
  description:
    "Halaman masuk SSO SACIBIRU dan pengujian peran lokal Sistem Informasi RPL.",
};

async function LoginContent() {
  const currentSession = await getSession();
  const isDevEnabled = process.env.NODE_ENV !== "production";

  return (
    <DevLoginPanel
      isDevEnabled={isDevEnabled}
      currentSession={currentSession}
    />
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-[var(--color-bg-page)] px-4 py-8 sm:px-6">
      <div className="my-auto w-full max-w-[520px] overflow-hidden rounded-[24px] bg-[var(--color-bg-surface)] shadow-[0px_8px_28px_rgba(11,42,76,0.06)]">
        <header className="rounded-br-[24px] bg-[var(--color-primary)] px-6 py-6 text-white sm:px-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.6px] text-[var(--color-secondary)]">
            Program Studi RPL UPI Kampus Cibiru
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-lexend)] text-[24px] font-bold leading-[28px] sm:text-[28px] sm:leading-[32px]">
            Masuk Sistem Informasi
          </h1>
          <p className="mt-2 text-[13px] leading-[20px] text-[#e3e8ff]">
            Portal terintegrasi untuk modul Tridarma Dosen dan Arsip Program Studi.
          </p>
        </header>

        <div className="p-6 sm:p-8">
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col gap-3 py-6"
              >
                <div className="h-12 w-full animate-pulse rounded-[12px] bg-[var(--color-tint-neutral)]" />
                <div className="h-32 w-full animate-pulse rounded-[12px] bg-[var(--color-tint-neutral)]" />
                <p className="text-center text-[12px] text-[var(--color-text-muted)]">
                  Memeriksa status sesi...
                </p>
              </div>
            }
          >
            <LoginContent />
          </Suspense>

          <footer className="mt-6 border-t border-[var(--color-border-default)] pt-4 text-center">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[8px] px-3 text-[13px] font-semibold text-[var(--color-primary-strong)] hover:underline"
            >
              Kembali ke Beranda
            </Link>
          </footer>
        </div>
      </div>
    </main>
  );
}
