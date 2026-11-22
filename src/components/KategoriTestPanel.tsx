"use client";

import { useEffect, useState, type FormEvent } from "react";

interface KategoriItem {
  id: number;
  kode: string;
  nama: string;
  retensi_aktif_tahun: number;
  retensi_inaktif_tahun: number;
  keterangan: string | null;
  jumlah_arsip: number;
}

interface KategoriResponse {
  items: KategoriItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  message?: string;
}

interface FormState {
  kode: string;
  nama: string;
  retensiAktifTahun: string;
  retensiInaktifTahun: string;
  keterangan: string;
}

interface ApiFeedback {
  type: "success" | "error";
  status: number | null;
  message: string;
}

const INITIAL_FORM: FormState = {
  kode: "",
  nama: "",
  retensiAktifTahun: "2",
  retensiInaktifTahun: "3",
  keterangan: "",
};

function parseApiMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

export function KategoriTestPanel({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<KategoriItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [retensiInput, setRetensiInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedRetensi, setAppliedRetensi] = useState("");

  const [reloadTick, setReloadTick] = useState(0);
  const currentQuery = `${page}|${appliedSearch}|${appliedRetensi}|${reloadTick}`;
  const [settledQuery, setSettledQuery] = useState("");
  const isLoading = settledQuery !== currentQuery;
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ApiFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page) });
    if (appliedSearch) qs.set("search", appliedSearch);
    if (appliedRetensi) qs.set("retensi", appliedRetensi);

    fetch(`/api/arsip/kategori?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as KategoriResponse | null;
        if (cancelled) return;

        if (!res.ok || !data || !Array.isArray(data.items)) {
          setLoadError(
            `HTTP ${res.status}: ${parseApiMessage(data, "Gagal memuat data kategori.")}`,
          );
          setItems([]);
          return;
        }

        setLoadError(null);
        setItems(data.items);
        setTotalPages(data.pagination?.totalPages ?? 1);
        setTotal(data.pagination?.total ?? data.items.length);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Gagal terhubung ke endpoint GET /api/arsip/kategori.");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setSettledQuery(currentQuery);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, appliedSearch, appliedRetensi, currentQuery]);

  function reloadKategori() {
    setReloadTick((t) => t + 1);
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
    setAppliedRetensi(retensiInput.trim());
  }

  function handleResetFilter() {
    setSearchInput("");
    setRetensiInput("");
    setAppliedSearch("");
    setAppliedRetensi("");
    setPage(1);
  }

  function handleSelectEdit(item: KategoriItem) {
    setEditingId(item.id);
    setForm({
      kode: item.kode,
      nama: item.nama,
      retensiAktifTahun: String(item.retensi_aktif_tahun),
      retensiInaktifTahun: String(item.retensi_inaktif_tahun),
      keterangan: item.keterangan ?? "",
    });
    setFeedback(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(INITIAL_FORM);
    setFeedback(null);
  }

  async function submitMutation(mode: "post" | "patch") {
    if (!canManage || isSubmitting) return;
    if (mode === "patch" && editingId === null) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const targetUrl =
        mode === "patch"
          ? `/api/arsip/kategori/${editingId}`
          : "/api/arsip/kategori";

      const res = await fetch(targetUrl, {
        method: mode === "patch" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kode: form.kode,
          nama: form.nama,
          retensiAktifTahun: form.retensiAktifTahun,
          retensiInaktifTahun: form.retensiInaktifTahun,
          keterangan: form.keterangan,
        }),
      });

      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(
            payload,
            mode === "patch"
              ? "Permintaan PATCH gagal diproses."
              : "Permintaan POST gagal diproses.",
          ),
        });
        return;
      }

      setFeedback({
        type: "success",
        status: res.status,
        message: parseApiMessage(
          payload,
          mode === "patch"
            ? "Kategori berhasil diperbarui."
            : "Kategori berhasil ditambahkan.",
        ),
      });
      setEditingId(null);
      setForm(INITIAL_FORM);
      reloadKategori();
    } catch {
      setFeedback({
        type: "error",
        status: null,
        message: "Terjadi kesalahan jaringan saat mengirim data kategori.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(item: KategoriItem) {
    if (!canManage || deletingId !== null || isSubmitting) return;
    if (!window.confirm(`Hapus kategori ${item.kode} (${item.nama})?`)) return;

    setDeletingId(item.id);
    setFeedback(null);

    try {
      const res = await fetch(`/api/arsip/kategori/${item.id}`, {
        method: "DELETE",
      });
      const payload: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(payload, "Gagal menghapus kategori."),
        });
        return;
      }

      if (editingId === item.id) {
        setEditingId(null);
        setForm(INITIAL_FORM);
      }

      setFeedback({
        type: "success",
        status: res.status,
        message: parseApiMessage(payload, "Kategori berhasil dihapus."),
      });
      reloadKategori();
    } catch {
      setFeedback({
        type: "error",
        status: null,
        message: "Terjadi kesalahan jaringan saat menghapus kategori.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMutation(editingId !== null ? "patch" : "post");
  }

  const inputClassName =
    "min-h-[44px] w-full rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/70 disabled:bg-[var(--color-tint-neutral)] disabled:opacity-70";

  return (
    <section
      aria-labelledby="kategori-uji-heading"
      className="flex flex-col gap-6 border-t border-[var(--color-border-default)] pt-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2
            id="kategori-uji-heading"
            className="font-[family-name:var(--font-lexend)] text-[18px] font-bold text-[var(--color-text-primary)]"
          >
            Uji API Kategori Arsip
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Form POST / Edit dan tabel GET untuk /api/arsip/kategori.
          </p>
        </div>
        <button
          type="button"
          onClick={reloadKategori}
          disabled={isLoading}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
        >
          {isLoading ? "Memuat..." : "Muat Ulang Tabel"}
        </button>
      </div>

      {/* Form Input POST / Edit */}
      <form
        onSubmit={handleFormSubmit}
        className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-[family-name:var(--font-lexend)] text-[15px] font-semibold text-[var(--color-text-primary)]">
            {editingId !== null
              ? `Mode Edit Kategori (ID: ${editingId})`
              : "Tambah Kategori Baru (POST)"}
          </h3>
          {editingId !== null && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)]"
            >
              Batal Edit
            </button>
          )}
        </div>

        {!canManage && (
          <p
            role="status"
            className="rounded-[10px] border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-[13px] text-[var(--color-text-secondary)]"
          >
            Mode baca saja (Kaprodi): hanya Staff Kaprodi / Admin yang dapat mengirim POST, Edit, atau Hapus kategori.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="kategori-kode"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Kode (maks. 5 huruf kapital)
            </label>
            <input
              id="kategori-kode"
              name="kode"
              type="text"
              value={form.kode}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, kode: e.target.value }))
              }
              placeholder="Contoh: KEU"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-1 lg:col-span-2">
            <label
              htmlFor="kategori-nama"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Nama Kategori
            </label>
            <input
              id="kategori-nama"
              name="nama"
              type="text"
              value={form.nama}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, nama: e.target.value }))
              }
              placeholder="Contoh: Arsip Keuangan"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="kategori-keterangan"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Keterangan (opsional)
            </label>
            <input
              id="kategori-keterangan"
              name="keterangan"
              type="text"
              value={form.keterangan}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, keterangan: e.target.value }))
              }
              placeholder="Catatan singkat"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="kategori-retensi-aktif"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Retensi Aktif (tahun)
            </label>
            <input
              id="kategori-retensi-aktif"
              name="retensiAktifTahun"
              type="number"
              min={1}
              value={form.retensiAktifTahun}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  retensiAktifTahun: e.target.value,
                }))
              }
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="kategori-retensi-inaktif"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Retensi Inaktif (tahun)
            </label>
            <input
              id="kategori-retensi-inaktif"
              name="retensiInaktifTahun"
              type="number"
              min={1}
              value={form.retensiInaktifTahun}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  retensiInaktifTahun: e.target.value,
                }))
              }
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {editingId !== null ? (
            <>
              <button
                type="submit"
                disabled={!canManage || isSubmitting}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-[var(--color-primary-strong)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)] active:bg-[var(--color-text-primary)] disabled:opacity-55"
              >
                {isSubmitting ? "Mengirim..." : "Simpan Edit (PATCH)"}
              </button>
              <button
                type="button"
                onClick={() => void submitMutation("post")}
                disabled={!canManage || isSubmitting}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
              >
                Kirim sebagai POST Baru
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={!canManage || isSubmitting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-[var(--color-primary-strong)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)] active:bg-[var(--color-text-primary)] disabled:opacity-55"
            >
              {isSubmitting ? "Mengirim..." : "Kirim POST Kategori"}
            </button>
          )}
        </div>

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium ${
              feedback.type === "success"
                ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                : "bg-[var(--color-danger-bg)] text-[var(--color-danger-solid)]"
            }`}
          >
            {feedback.status !== null ? `HTTP ${feedback.status}: ` : ""}
            {feedback.message}
          </div>
        )}
      </form>

      {/* Filter & Tabel GET */}
      <div className="flex flex-col gap-3">
        <form
          onSubmit={handleFilterSubmit}
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-12 sm:items-end"
        >
          <div className="flex flex-col gap-1.5 sm:col-span-5">
            <label
              htmlFor="filter-search"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Cari Kode atau Nama
            </label>
            <input
              id="filter-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Contoh: KEU atau Keuangan"
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-4">
            <label
              htmlFor="filter-retensi"
              className="text-[13px] font-semibold text-[var(--color-text-primary)]"
            >
              Filter Retensi (opsional)
            </label>
            <input
              id="filter-retensi"
              type="text"
              value={retensiInput}
              onChange={(e) => setRetensiInput(e.target.value)}
              placeholder="Contoh: 2 atau 2/3"
              className={inputClassName}
            />
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button
              type="submit"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)]"
            >
              Cari
            </button>
            <button
              type="button"
              onClick={handleResetFilter}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)]"
            >
              Reset
            </button>
          </div>
        </form>

        {isLoading ? (
          <p
            role="status"
            className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]"
          >
            Memuat daftar kategori dari /api/arsip/kategori...
          </p>
        ) : loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--color-danger-bg)] px-4 py-3 text-[13px] font-medium text-[var(--color-danger-solid)]"
          >
            <span>{loadError}</span>
            <button
              type="button"
              onClick={reloadKategori}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)]"
            >
              Coba Lagi
            </button>
          </div>
        ) : items.length === 0 ? (
          <p
            role="status"
            className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]"
          >
            Belum ada data kategori yang sesuai filter.
          </p>
        ) : (
          <>
            {/* Mobile stacked view */}
            <ul className="flex flex-col gap-2.5 sm:hidden">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 rounded-[12px] border border-[var(--color-border-default)] bg-white p-3.5 text-[13px]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-bold text-[var(--color-text-primary)]">
                        {item.kode}
                      </span>
                      <span className="mx-1.5 text-[var(--color-text-secondary)]">
                        -
                      </span>
                      <span className="font-semibold text-[var(--color-text-primary)]">
                        {item.nama}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-[6px] bg-[var(--color-tint-neutral)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text-primary)]">
                      {item.jumlah_arsip} arsip
                    </span>
                  </div>
                  <p className="text-[var(--color-text-secondary)]">
                    Retensi: {item.retensi_aktif_tahun} th aktif /{" "}
                    {item.retensi_inaktif_tahun} th inaktif
                  </p>
                  {item.keterangan && (
                    <p className="text-[var(--color-text-secondary)]">
                      Keterangan: {item.keterangan}
                    </p>
                  )}
                  {canManage && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSelectEdit(item)}
                        disabled={deletingId === item.id}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
                      >
                        Edit {item.kode}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item)}
                        disabled={deletingId !== null || isSubmitting}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)] active:bg-[var(--color-danger-bg)] disabled:opacity-55"
                      >
                        {deletingId === item.id ? "Menghapus..." : "Hapus"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Desktop/tablet table view */}
            <div className="hidden overflow-x-auto rounded-[12px] border border-[var(--color-border-default)] sm:block">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-[var(--color-bg-page)] text-[var(--color-text-primary)]">
                  <tr className="border-b border-[var(--color-border-default)]">
                    <th className="px-3.5 py-2.5 font-semibold">Kode</th>
                    <th className="px-3.5 py-2.5 font-semibold">Nama</th>
                    <th className="px-3.5 py-2.5 font-semibold">Retensi</th>
                    <th className="px-3.5 py-2.5 font-semibold">Keterangan</th>
                    <th className="px-3.5 py-2.5 font-semibold">Arsip</th>
                    <th className="px-3.5 py-2.5 font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-default)] bg-white">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        editingId === item.id
                          ? "bg-[var(--color-tint-primary)]"
                          : ""
                      }
                    >
                      <td className="px-3.5 py-2.5 font-bold text-[var(--color-text-primary)]">
                        {item.kode}
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-[var(--color-text-primary)]">
                        {item.nama}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-[var(--color-text-secondary)]">
                        {item.retensi_aktif_tahun} th /{" "}
                        {item.retensi_inaktif_tahun} th
                      </td>
                      <td className="px-3.5 py-2.5 text-[var(--color-text-secondary)]">
                        {item.keterangan || "-"}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap font-medium text-[var(--color-text-primary)]">
                        {item.jumlah_arsip}
                      </td>
                      <td className="px-3.5 py-2">
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleSelectEdit(item)}
                              disabled={deletingId === item.id}
                              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(item)}
                              disabled={deletingId !== null || isSubmitting}
                              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)] active:bg-[var(--color-danger-bg)] disabled:opacity-55"
                            >
                              {deletingId === item.id ? "Menghapus..." : "Hapus"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[var(--color-text-secondary)]">
                            -
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--color-text-secondary)]">
          <span>
            Halaman {page} dari {totalPages} (Total: {total} kategori)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isLoading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={isLoading || page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
