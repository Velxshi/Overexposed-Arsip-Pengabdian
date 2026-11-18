import Link from "next/link";

export default function AksesDitolakPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-[var(--color-bg-page)] px-4 py-12">
      <div className="my-auto w-full max-w-md rounded-[18px] bg-[var(--color-bg-surface)] p-8 text-center shadow-[0px_4px_20px_rgba(11,42,76,0.06)]">
        <span className="inline-block rounded-[6px] bg-[var(--color-danger-bg)] px-3 py-1 text-[12px] font-bold uppercase tracking-[0.6px] text-[var(--color-danger-solid)]">
          403 Akses Ditolak
        </span>
        <h1 className="mt-4 font-[family-name:var(--font-lexend)] text-[24px] font-bold leading-[30px] text-[var(--color-text-primary)]">
          Anda tidak memiliki izin membuka halaman ini
        </h1>
        <p className="mt-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
          Peran akun Anda tidak diizinkan untuk mengakses atau melakukan tindakan pada modul ini.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/tridharma"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[12px] bg-[var(--color-primary-strong)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)]"
          >
            Ke Halaman Tridarma
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[12px] border border-[var(--color-border-strong)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)]"
          >
            Ganti Role (/login)
          </Link>
        </div>
      </div>
    </main>
  );
}
