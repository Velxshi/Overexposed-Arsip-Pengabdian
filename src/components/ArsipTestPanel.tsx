"use client";

import { useEffect, useState, type FormEvent } from "react";

export interface KategoriOption {
  id: number;
  kode: string;
  nama: string;
  retensi_aktif_tahun: number;
  retensi_inaktif_tahun: number;
}

interface ArsipListItem {
  id: number;
  nomor_arsip: string;
  nomor_surat: string;
  judul: string;
  tanggal_arsip: string;
  kategori_id: number;
  kategori: {
    kode: string;
    nama: string;
  };
  retensi_aktif_tahun: number;
  retensi_inaktif_tahun: number;
}

interface ArsipDetail extends ArsipListItem {
  pencipta_unit: string | null;
  link_berkas: string;
  keterangan: string | null;
  status_validasi: "Pending" | "Diterima" | "Ditolak";
  catatan_validasi: string | null;
  status_retensi: "Aktif" | "Inaktif" | "Dimusnahkan";
  tanggal_habis_aktif: string;
  tanggal_habis_inaktif: string;
}

interface ArsipListResponse {
  items: ArsipListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  message?: string;
}

interface FormState {
  nomorArsip: string;
  nomorSurat: string;
  judul: string;
  kategoriId: string;
  tanggalArsip: string;
  pencipta_unit: string;
  linkBerkas: string;
  keterangan: string;
  retensiAktifTahun: string;
  retensiInaktifTahun: string;
}

interface ApiFeedback {
  type: "success" | "error";
  status: number | null;
  message: string;
}

function parseApiMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function formatTanggal(isoDate: string): string {
  return isoDate.slice(0, 10);
}

type StatusValidasiTab = "Pending" | "Diterima" | "Ditolak";

const VALIDASI_TABS: StatusValidasiTab[] = ["Pending", "Diterima", "Ditolak"];

interface ArsipValidasiListResponse {
  items: ArsipDetail[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  message?: string;
}

export function ArsipTestPanel({
  canManage,
  canValidate,
  role,
  kategoriOptions,
}: {
  canManage: boolean;
  canValidate?: boolean;
  role: string;
  kategoriOptions: KategoriOption[];
}) {
  const isKaprodiValidator = canValidate ?? role === "Kaprodi";
  const defaultKategoriId = kategoriOptions[0] ? String(kategoriOptions[0].id) : "";
  const buildInitialForm = (): FormState => ({
    nomorArsip: "",
    nomorSurat: "",
    judul: "",
    kategoriId: defaultKategoriId,
    tanggalArsip: "",
    pencipta_unit: "",
    linkBerkas: "",
    keterangan: "",
    retensiAktifTahun: "",
    retensiInaktifTahun: "",
  });

  const [items, setItems] = useState<ArsipListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [kategoriInput, setKategoriInput] = useState("");
  const [tahunInput, setTahunInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedKategori, setAppliedKategori] = useState("");
  const [appliedTahun, setAppliedTahun] = useState("");

  const [reloadTick, setReloadTick] = useState(0);
  const currentQuery = `${page}|${appliedSearch}|${appliedKategori}|${appliedTahun}|${reloadTick}`;
  const [settledQuery, setSettledQuery] = useState("");
  const isLoading = settledQuery !== currentQuery;
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(buildInitialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ArsipDetail | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ApiFeedback | null>(null);

  const [validasiTab, setValidasiTab] = useState<StatusValidasiTab>("Pending");
  const [validasiPage, setValidasiPage] = useState(1);
  const [validasiItems, setValidasiItems] = useState<ArsipDetail[]>([]);
  const [validasiTotalPages, setValidasiTotalPages] = useState(1);
  const [validasiTotal, setValidasiTotal] = useState(0);
  const [validasiReloadTick, setValidasiReloadTick] = useState(0);
  const currentValidasiQuery = isKaprodiValidator ? `${validasiTab}|${validasiPage}|${validasiReloadTick}` : "";
  const [settledValidasiQuery, setSettledValidasiQuery] = useState("");
  const isValidasiLoading = isKaprodiValidator && settledValidasiQuery !== currentValidasiQuery;
  const [validasiLoadError, setValidasiLoadError] = useState<string | null>(null);
  const [catatanValidasiInput, setCatatanValidasiInput] = useState("");
  const [validatingId, setValidatingId] = useState<number | null>(null);
  const [validasiFeedback, setValidasiFeedback] = useState<ApiFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page) });
    if (appliedSearch) qs.set("search", appliedSearch);
    if (appliedKategori) qs.set("kategoriId", appliedKategori);
    if (appliedTahun) qs.set("tahun", appliedTahun);

    fetch(`/api/arsip?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as ArsipListResponse | null;
        if (cancelled) return;

        if (!res.ok || !data || !Array.isArray(data.items)) {
          setLoadError(`HTTP ${res.status}: ${parseApiMessage(data, "Gagal memuat daftar arsip.")}`);
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
        setLoadError("Gagal terhubung ke endpoint GET /api/arsip.");
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
  }, [page, appliedSearch, appliedKategori, appliedTahun, currentQuery]);

  function reloadArsip() {
    setReloadTick((t) => t + 1);
  }

  function reloadValidasi() {
    setValidasiReloadTick((t) => t + 1);
  }

  useEffect(() => {
    if (!isKaprodiValidator) return;

    let cancelled = false;
    const qs = new URLSearchParams({
      status: validasiTab,
      page: String(validasiPage),
    });

    fetch(`/api/arsip/validasi?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as ArsipValidasiListResponse | null;
        if (cancelled) return;

        if (!res.ok || !data || !Array.isArray(data.items)) {
          setValidasiLoadError(`HTTP ${res.status}: ${parseApiMessage(data, "Gagal memuat daftar validasi arsip.")}`);
          setValidasiItems([]);
          return;
        }

        setValidasiLoadError(null);
        setValidasiItems(data.items);
        setValidasiTotalPages(data.pagination?.totalPages ?? 1);
        setValidasiTotal(data.pagination?.total ?? data.items.length);
      })
      .catch(() => {
        if (cancelled) return;
        setValidasiLoadError("Gagal terhubung ke endpoint GET /api/arsip/validasi.");
        setValidasiItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setSettledValidasiQuery(currentValidasiQuery);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isKaprodiValidator, validasiTab, validasiPage, currentValidasiQuery]);

  async function handleValidasiSubmit(id: number, keputusan: "Diterima" | "Ditolak") {
    if (!isKaprodiValidator || validatingId !== null) return;

    setValidatingId(id);
    setValidasiFeedback(null);

    try {
      const res = await fetch(`/api/arsip/${id}/validasi`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status_validasi: keputusan,
          catatan_validasi: catatanValidasiInput,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        data?: ArsipDetail;
        message?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        setValidasiFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(payload, "Gagal memvalidasi arsip."),
        });
        return;
      }

      setValidasiFeedback({
        type: "success",
        status: res.status,
        message: parseApiMessage(payload, `Arsip berhasil divalidasi (${keputusan}).`),
      });

      if (payload?.data && selectedDetail?.id === id) {
        setSelectedDetail(payload.data);
      }

      setCatatanValidasiInput("");
      reloadValidasi();
      reloadArsip();
    } catch {
      setValidasiFeedback({
        type: "error",
        status: null,
        message: "Terjadi kesalahan jaringan saat mengirim validasi arsip.",
      });
    } finally {
      setValidatingId(null);
    }
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
    setAppliedKategori(kategoriInput.trim());
    setAppliedTahun(tahunInput.trim());
  }

  function handleResetFilter() {
    setSearchInput("");
    setKategoriInput("");
    setTahunInput("");
    setAppliedSearch("");
    setAppliedKategori("");
    setAppliedTahun("");
    setPage(1);
  }

  async function fetchArsipDetail(id: number): Promise<ArsipDetail | null> {
    setLoadingDetailId(id);
    try {
      const res = await fetch(`/api/arsip/${id}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as {
        data?: ArsipDetail;
        message?: string;
      } | null;

      if (!res.ok || !payload?.data) {
        setFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(payload, "Gagal mengambil detail arsip."),
        });
        return null;
      }

      return payload.data;
    } catch {
      setFeedback({
        type: "error",
        status: null,
        message: "Gagal terhubung ke endpoint GET /api/arsip/[id].",
      });
      return null;
    } finally {
      setLoadingDetailId(null);
    }
  }

  async function handleViewDetail(id: number) {
    setFeedback(null);
    const detail = await fetchArsipDetail(id);
    if (detail) setSelectedDetail(detail);
  }

  async function handleSelectEdit(id: number) {
    setFeedback(null);
    const detail = await fetchArsipDetail(id);
    if (!detail) return;

    setEditingId(detail.id);
    setForm({
      nomorArsip: detail.nomor_arsip,
      nomorSurat: detail.nomor_surat,
      judul: detail.judul,
      kategoriId: String(detail.kategori_id),
      tanggalArsip: formatTanggal(detail.tanggal_arsip),
      pencipta_unit: detail.pencipta_unit ?? "",
      linkBerkas: detail.link_berkas,
      keterangan: detail.keterangan ?? "",
      retensiAktifTahun: String(detail.retensi_aktif_tahun),
      retensiInaktifTahun: String(detail.retensi_inaktif_tahun),
    });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(buildInitialForm());
    setFeedback(null);
  }

  async function submitMutation(mode: "post" | "patch") {
    if (!canManage || isSubmitting) return;
    if (mode === "patch" && editingId === null) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const targetUrl = mode === "patch" ? `/api/arsip/${editingId}` : "/api/arsip";

      const res = await fetch(targetUrl, {
        method: mode === "patch" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomorArsip: form.nomorArsip,
          nomorSurat: form.nomorSurat,
          judul: form.judul,
          kategoriId: form.kategoriId,
          tanggalArsip: form.tanggalArsip,
          pencipta_unit: form.pencipta_unit,
          linkBerkas: form.linkBerkas,
          keterangan: form.keterangan,
          ...(form.retensiAktifTahun.trim() !== "" ? { retensiAktifTahun: form.retensiAktifTahun } : {}),
          ...(form.retensiInaktifTahun.trim() !== "" ? { retensiInaktifTahun: form.retensiInaktifTahun } : {}),
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        data?: ArsipDetail;
        message?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        setFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(payload, mode === "patch" ? "Permintaan PATCH arsip gagal diproses." : "Permintaan POST arsip gagal diproses."),
        });
        return;
      }

      setFeedback({
        type: "success",
        status: res.status,
        message: parseApiMessage(payload, mode === "patch" ? "Arsip berhasil diperbarui." : "Arsip berhasil ditambahkan."),
      });

      if (mode === "patch" && payload?.data && selectedDetail?.id === editingId) {
        setSelectedDetail(payload.data);
      }

      setEditingId(null);
      setForm(buildInitialForm());
      reloadArsip();
    } catch {
      setFeedback({
        type: "error",
        status: null,
        message: "Terjadi kesalahan jaringan saat mengirim data arsip.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(item: ArsipListItem) {
    if (!canManage || deletingId !== null || isSubmitting) return;
    if (!window.confirm(`Hapus permanen arsip ${item.nomor_arsip} (${item.judul})?`)) {
      return;
    }

    setDeletingId(item.id);
    setFeedback(null);

    try {
      const res = await fetch(`/api/arsip/${item.id}`, { method: "DELETE" });
      const payload: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setFeedback({
          type: "error",
          status: res.status,
          message: parseApiMessage(payload, "Gagal menghapus arsip."),
        });
        return;
      }

      if (editingId === item.id) {
        setEditingId(null);
        setForm(buildInitialForm());
      }
      if (selectedDetail?.id === item.id) {
        setSelectedDetail(null);
      }

      setFeedback({
        type: "success",
        status: res.status,
        message: parseApiMessage(payload, "Arsip berhasil dihapus permanen."),
      });
      reloadArsip();
    } catch {
      setFeedback({
        type: "error",
        status: null,
        message: "Terjadi kesalahan jaringan saat menghapus arsip.",
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
    <section aria-labelledby="arsip-uji-heading" className="flex flex-col gap-6 border-t border-[var(--color-border-default)] pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="arsip-uji-heading" className="font-[family-name:var(--font-lexend)] text-[18px] font-bold text-[var(--color-text-primary)]">
            Uji API Daftar &amp; Input Arsip
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">Form POST / PATCH dan tabel GET / Detail / DELETE untuk /api/arsip.</p>
        </div>
        <button
          type="button"
          onClick={reloadArsip}
          disabled={isLoading}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
        >
          {isLoading ? "Memuat..." : "Muat Ulang Tabel"}
        </button>
      </div>

      {/* Form Input POST / PATCH Arsip */}
      <form onSubmit={handleFormSubmit} className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-[family-name:var(--font-lexend)] text-[15px] font-semibold text-[var(--color-text-primary)]">{editingId !== null ? `Mode Edit Arsip (ID: ${editingId})` : "Tambah Arsip Baru (POST)"}</h3>
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
          <p role="status" className="rounded-[10px] border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-[13px] text-[var(--color-text-secondary)]">
            Mode baca saja ({role}): hanya Staff Kaprodi / Admin yang dapat mengirim POST, Edit (PATCH), atau Hapus arsip.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-nomor-arsip" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Nomor Arsip (unik)
            </label>
            <input
              id="arsip-nomor-arsip"
              type="text"
              value={form.nomorArsip}
              onChange={(e) => setForm((prev) => ({ ...prev, nomorArsip: e.target.value }))}
              placeholder="Contoh: ARS-2026-001"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-nomor-surat" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Nomor Surat
            </label>
            <input
              id="arsip-nomor-surat"
              type="text"
              value={form.nomorSurat}
              onChange={(e) => setForm((prev) => ({ ...prev, nomorSurat: e.target.value }))}
              placeholder="Contoh: 012/RPL/2026"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-tanggal" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Tanggal Arsip
            </label>
            <input id="arsip-tanggal" type="date" value={form.tanggalArsip} onChange={(e) => setForm((prev) => ({ ...prev, tanggalArsip: e.target.value }))} disabled={!canManage || isSubmitting} className={inputClassName} />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="arsip-judul" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Judul Arsip
            </label>
            <input
              id="arsip-judul"
              type="text"
              value={form.judul}
              onChange={(e) => setForm((prev) => ({ ...prev, judul: e.target.value }))}
              placeholder="Contoh: SK Pembimbing Tugas Akhir"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-kategori" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Kategori
            </label>
            <select id="arsip-kategori" value={form.kategoriId} onChange={(e) => setForm((prev) => ({ ...prev, kategoriId: e.target.value }))} disabled={!canManage || isSubmitting || kategoriOptions.length === 0} className={inputClassName}>
              {kategoriOptions.length === 0 ? (
                <option value="">Belum ada kategori</option>
              ) : (
                kategoriOptions.map((k) => (
                  <option key={k.id} value={String(k.id)}>
                    {k.kode} - {k.nama} ({k.retensi_aktif_tahun}/{k.retensi_inaktif_tahun} th)
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-pencipta" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Pencipta Unit (opsional)
            </label>
            <input
              id="arsip-pencipta"
              type="text"
              value={form.pencipta_unit}
              onChange={(e) => setForm((prev) => ({ ...prev, pencipta_unit: e.target.value }))}
              placeholder="Contoh: Prodi RPL"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="arsip-link" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Link Berkas
            </label>
            <input
              id="arsip-link"
              type="text"
              value={form.linkBerkas}
              onChange={(e) => setForm((prev) => ({ ...prev, linkBerkas: e.target.value }))}
              placeholder="Contoh: https://drive.google.com/file/d/..."
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-retensi-aktif" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Retensi Aktif (opsional)
            </label>
            <input
              id="arsip-retensi-aktif"
              type="number"
              min={0}
              value={form.retensiAktifTahun}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  retensiAktifTahun: e.target.value,
                }))
              }
              placeholder="Kosong = ikut kategori"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-retensi-inaktif" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Retensi Inaktif (opsional)
            </label>
            <input
              id="arsip-retensi-inaktif"
              type="number"
              min={0}
              value={form.retensiInaktifTahun}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  retensiInaktifTahun: e.target.value,
                }))
              }
              placeholder="Kosong = ikut kategori"
              disabled={!canManage || isSubmitting}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="arsip-keterangan" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Keterangan (opsional)
            </label>
            <input
              id="arsip-keterangan"
              type="text"
              value={form.keterangan}
              onChange={(e) => setForm((prev) => ({ ...prev, keterangan: e.target.value }))}
              placeholder="Catatan tambahan"
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
              {isSubmitting ? "Mengirim..." : "Kirim POST Arsip"}
            </button>
          )}
        </div>

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium ${feedback.type === "success" ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger-solid)]"}`}
          >
            {feedback.status !== null ? `HTTP ${feedback.status}: ` : ""}
            {feedback.message}
          </div>
        )}
      </form>

      {/* Filter & Tabel GET Arsip */}
      <div className="flex flex-col gap-3">
        <form onSubmit={handleFilterSubmit} className="grid grid-cols-1 gap-2.5 sm:grid-cols-12 sm:items-end">
          <div className="flex flex-col gap-1.5 sm:col-span-4">
            <label htmlFor="arsip-filter-search" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Cari Judul atau No. Surat
            </label>
            <input id="arsip-filter-search" type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Judul atau nomor surat" className={inputClassName} />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <label htmlFor="arsip-filter-kategori" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Filter Kategori
            </label>
            <select id="arsip-filter-kategori" value={kategoriInput} onChange={(e) => setKategoriInput(e.target.value)} className={inputClassName}>
              <option value="">Semua kategori</option>
              {kategoriOptions.map((k) => (
                <option key={k.id} value={String(k.id)}>
                  {k.kode} - {k.nama}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="arsip-filter-tahun" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              Tahun
            </label>
            <input id="arsip-filter-tahun" type="number" min={1900} max={9999} value={tahunInput} onChange={(e) => setTahunInput(e.target.value)} placeholder="2026" className={inputClassName} />
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
          <p role="status" className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]">
            Memuat daftar arsip dari /api/arsip...
          </p>
        ) : loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--color-danger-bg)] px-4 py-3 text-[13px] font-medium text-[var(--color-danger-solid)]">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={reloadArsip}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)]"
            >
              Coba Lagi
            </button>
          </div>
        ) : items.length === 0 ? (
          <p role="status" className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]">
            Belum ada data arsip yang sesuai filter.
          </p>
        ) : (
          <>
            {/* Mobile stacked view */}
            <ul className="flex flex-col gap-2.5 sm:hidden">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--color-border-default)] bg-white p-3.5 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-[var(--color-text-primary)]">{item.nomor_arsip}</span>
                    <span className="shrink-0 rounded-[6px] bg-[var(--color-tint-neutral)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text-primary)]">{item.kategori.kode}</span>
                  </div>
                  <p className="font-semibold text-[var(--color-text-primary)]">{item.judul}</p>
                  <p className="text-[var(--color-text-secondary)]">
                    No. Surat: {item.nomor_surat} | Tgl: {formatTanggal(item.tanggal_arsip)}
                  </p>
                  <p className="text-[var(--color-text-secondary)]">
                    Kategori: {item.kategori.kode} - {item.kategori.nama}
                  </p>
                  <p className="text-[var(--color-text-secondary)]">
                    Retensi: {item.retensi_aktif_tahun} th aktif / {item.retensi_inaktif_tahun} th inaktif
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleViewDetail(item.id)}
                      disabled={loadingDetailId === item.id}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
                    >
                      {loadingDetailId === item.id ? "Memuat..." : "Detail"}
                    </button>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSelectEdit(item.id)}
                          disabled={loadingDetailId === item.id || deletingId === item.id}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          disabled={deletingId !== null || isSubmitting}
                          className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)] active:bg-[var(--color-danger-bg)] disabled:opacity-55"
                        >
                          {deletingId === item.id ? "Menghapus..." : "Hapus"}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop/tablet table view */}
            <div className="hidden overflow-x-auto rounded-[12px] border border-[var(--color-border-default)] sm:block">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-[var(--color-bg-page)] text-[var(--color-text-primary)]">
                  <tr className="border-b border-[var(--color-border-default)]">
                    <th className="px-3.5 py-2.5 font-semibold">No. Arsip</th>
                    <th className="px-3.5 py-2.5 font-semibold">Judul</th>
                    <th className="px-3.5 py-2.5 font-semibold">Kategori</th>
                    <th className="px-3.5 py-2.5 font-semibold">Retensi</th>
                    <th className="px-3.5 py-2.5 font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-default)] bg-white">
                  {items.map((item) => (
                    <tr key={item.id} className={editingId === item.id ? "bg-[var(--color-tint-primary)]" : ""}>
                      <td className="px-3.5 py-2.5 whitespace-nowrap font-bold text-[var(--color-text-primary)]">
                        {item.nomor_arsip}
                        <div className="mt-0.5 text-[12px] font-normal text-[var(--color-text-secondary)]">{formatTanggal(item.tanggal_arsip)}</div>
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-[var(--color-text-primary)]">
                        {item.judul}
                        <div className="mt-0.5 text-[12px] font-normal text-[var(--color-text-secondary)]">Surat: {item.nomor_surat}</div>
                      </td>
                      <td className="px-3.5 py-2.5 text-[var(--color-text-secondary)]">
                        <span className="font-semibold text-[var(--color-text-primary)]">{item.kategori.kode}</span> - {item.kategori.nama}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-[var(--color-text-secondary)]">
                        {item.retensi_aktif_tahun} th / {item.retensi_inaktif_tahun} th
                      </td>
                      <td className="px-3.5 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleViewDetail(item.id)}
                            disabled={loadingDetailId === item.id}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
                          >
                            {loadingDetailId === item.id ? "Memuat..." : "Detail"}
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleSelectEdit(item.id)}
                                disabled={loadingDetailId === item.id || deletingId === item.id}
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
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selectedDetail && (
          <div role="region" aria-label="Detail arsip" className="flex flex-col gap-2 rounded-[12px] border border-[var(--color-border-strong)] bg-[var(--color-bg-page)] p-4 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-[family-name:var(--font-lexend)] text-[14px] font-bold text-[var(--color-text-primary)]">Detail Arsip: {selectedDetail.nomor_arsip}</h4>
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)]"
              >
                Tutup Detail
              </button>
            </div>
            <p className="text-[var(--color-text-primary)]">
              <span className="font-semibold">Judul:</span> {selectedDetail.judul}
            </p>
            <p className="text-[var(--color-text-primary)]">
              <span className="font-semibold">Nomor Surat:</span> {selectedDetail.nomor_surat}
            </p>
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">Status Validasi:</span> {selectedDetail.status_validasi} | <span className="font-semibold text-[var(--color-text-primary)]">Status Retensi:</span>{" "}
              {selectedDetail.status_retensi}
            </p>
            {selectedDetail.catatan_validasi && (
              <p className="text-[var(--color-text-secondary)]">
                <span className="font-semibold text-[var(--color-text-primary)]">Catatan Validasi:</span> {selectedDetail.catatan_validasi}
              </p>
            )}
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">Batas Retensi:</span> Aktif s.d. {formatTanggal(selectedDetail.tanggal_habis_aktif)} | Inaktif s.d. {formatTanggal(selectedDetail.tanggal_habis_inaktif)}
            </p>
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">Pencipta Unit:</span> {selectedDetail.pencipta_unit || "-"} | <span className="font-semibold text-[var(--color-text-primary)]">Keterangan:</span>{" "}
              {selectedDetail.keterangan || "-"}
            </p>
            <p className="break-all text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">Link Berkas:</span>{" "}
              <a href={selectedDetail.link_berkas} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--color-primary-strong)] underline hover:text-[var(--color-primary)]">
                {selectedDetail.link_berkas}
              </a>
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--color-text-secondary)]">
          <span>
            Halaman {page} dari {totalPages} (Total: {total} arsip)
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

      {isKaprodiValidator && (
        <div className="flex flex-col gap-4 border-t border-[var(--color-border-default)] pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 id="arsip-validasi-heading" className="font-[family-name:var(--font-lexend)] text-[17px] font-bold text-[var(--color-text-primary)]">
                Uji API Validasi Arsip (Kaprodi)
              </h3>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                Tab GET /api/arsip/validasi?status=Pending|Diterima|Ditolak dan aksi PATCH /api/arsip/[id]/validasi.
              </p>
            </div>
            <button
              type="button"
              onClick={reloadValidasi}
              disabled={isValidasiLoading}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
            >
              {isValidasiLoading ? "Memuat..." : "Muat Ulang Validasi"}
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] p-4">
            <div role="tablist" aria-label="Tab status validasi arsip" className="flex flex-wrap gap-2">
              {VALIDASI_TABS.map((tab) => {
                const isActive = validasiTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setValidasiTab(tab);
                      setValidasiPage(1);
                      setValidasiFeedback(null);
                    }}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors ${
                      isActive
                        ? "bg-[var(--color-primary-strong)] text-white"
                        : "border border-[var(--color-border-strong)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--color-tint-neutral)]"
                    }`}
                  >
                    Status: {tab}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="arsip-catatan-validasi" className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                Catatan Validasi (wajib diisi saat Ditolak, opsional saat Diterima)
              </label>
              <input
                id="arsip-catatan-validasi"
                type="text"
                value={catatanValidasiInput}
                onChange={(e) => setCatatanValidasiInput(e.target.value)}
                placeholder="Tulis alasan penolakan atau catatan persetujuan sebelum menekan tombol Terima / Tolak"
                disabled={validatingId !== null}
                className={inputClassName}
              />
            </div>

            {validasiFeedback && (
              <div
                role={validasiFeedback.type === "error" ? "alert" : "status"}
                className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium ${
                  validasiFeedback.type === "success"
                    ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                    : "bg-[var(--color-danger-bg)] text-[var(--color-danger-solid)]"
                }`}
              >
                {validasiFeedback.status !== null ? `HTTP ${validasiFeedback.status}: ` : ""}
                {validasiFeedback.message}
              </div>
            )}
          </div>

          {isValidasiLoading ? (
            <p role="status" className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]">
              Memuat daftar validasi arsip ({validasiTab}) dari /api/arsip/validasi...
            </p>
          ) : validasiLoadError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--color-danger-bg)] px-4 py-3 text-[13px] font-medium text-[var(--color-danger-solid)]">
              <span>{validasiLoadError}</span>
              <button
                type="button"
                onClick={reloadValidasi}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)]"
              >
                Coba Lagi
              </button>
            </div>
          ) : validasiItems.length === 0 ? (
            <p role="status" className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-page)] px-4 py-6 text-center text-[13px] text-[var(--color-text-secondary)]">
              Belum ada arsip pada tab status {validasiTab}. Pilih tab status lain atau minta Staff Kaprodi menambahkan arsip.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2.5 sm:hidden">
                {validasiItems.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--color-border-default)] bg-white p-3.5 text-[13px]">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-[var(--color-text-primary)]">{item.nomor_arsip}</span>
                      <span
                        className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] font-semibold ${
                          item.status_validasi === "Diterima"
                            ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                            : item.status_validasi === "Ditolak"
                              ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-solid)]"
                              : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                        }`}
                      >
                        {item.status_validasi}
                      </span>
                    </div>
                    <p className="font-semibold text-[var(--color-text-primary)]">{item.judul}</p>
                    <p className="text-[var(--color-text-secondary)]">
                      No. Surat: {item.nomor_surat} | Tgl: {formatTanggal(item.tanggal_arsip)}
                    </p>
                    <p className="text-[var(--color-text-secondary)]">
                      Kategori: {item.kategori.kode} - {item.kategori.nama}
                    </p>
                    <p className="text-[var(--color-text-secondary)]">
                      Catatan: {item.catatan_validasi || "-"}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleValidasiSubmit(item.id, "Diterima")}
                        disabled={validatingId !== null}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] bg-[var(--color-primary-strong)] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)] active:bg-[var(--color-text-primary)] disabled:opacity-55"
                      >
                        {validatingId === item.id ? "Memproses..." : "Terima"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleValidasiSubmit(item.id, "Ditolak")}
                        disabled={validatingId !== null}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)] active:bg-[var(--color-danger-bg)] disabled:opacity-55"
                      >
                        {validatingId === item.id ? "Memproses..." : "Tolak"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto rounded-[12px] border border-[var(--color-border-default)] sm:block">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead className="bg-[var(--color-bg-page)] text-[var(--color-text-primary)]">
                    <tr className="border-b border-[var(--color-border-default)]">
                      <th className="px-3.5 py-2.5 font-semibold">No. Arsip</th>
                      <th className="px-3.5 py-2.5 font-semibold">Judul &amp; Surat</th>
                      <th className="px-3.5 py-2.5 font-semibold">Kategori</th>
                      <th className="px-3.5 py-2.5 font-semibold">Status &amp; Catatan</th>
                      <th className="px-3.5 py-2.5 font-semibold">Aksi Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-default)] bg-white">
                    {validasiItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3.5 py-2.5 whitespace-nowrap font-bold text-[var(--color-text-primary)]">
                          {item.nomor_arsip}
                          <div className="mt-0.5 text-[12px] font-normal text-[var(--color-text-secondary)]">{formatTanggal(item.tanggal_arsip)}</div>
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-[var(--color-text-primary)]">
                          {item.judul}
                          <div className="mt-0.5 text-[12px] font-normal text-[var(--color-text-secondary)]">Surat: {item.nomor_surat}</div>
                        </td>
                        <td className="px-3.5 py-2.5 text-[var(--color-text-secondary)]">
                          <span className="font-semibold text-[var(--color-text-primary)]">{item.kategori.kode}</span> - {item.kategori.nama}
                        </td>
                        <td className="px-3.5 py-2.5 text-[var(--color-text-secondary)]">
                          <span
                            className={`inline-block rounded-[6px] px-2 py-0.5 text-[12px] font-semibold ${
                              item.status_validasi === "Diterima"
                                ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                                : item.status_validasi === "Ditolak"
                                  ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-solid)]"
                                  : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                            }`}
                          >
                            {item.status_validasi}
                          </span>
                          <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                            Catatan: {item.catatan_validasi || "-"}
                          </div>
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleValidasiSubmit(item.id, "Diterima")}
                              disabled={validatingId !== null}
                              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-[var(--color-primary-strong)] px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary)] active:bg-[var(--color-text-primary)] disabled:opacity-55"
                            >
                              {validatingId === item.id ? "Memproses..." : "Terima"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleValidasiSubmit(item.id, "Ditolak")}
                              disabled={validatingId !== null}
                              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-danger-solid)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-danger-solid)] transition-colors hover:bg-[var(--color-danger-bg)] active:bg-[var(--color-danger-bg)] disabled:opacity-55"
                            >
                              {validatingId === item.id ? "Memproses..." : "Tolak"}
                            </button>
                          </div>
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
              Halaman {validasiPage} dari {validasiTotalPages} (Total: {validasiTotal} arsip {validasiTab})
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isValidasiLoading || validasiPage <= 1}
                onClick={() => setValidasiPage((p) => Math.max(1, p - 1))}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                disabled={isValidasiLoading || validasiPage >= validasiTotalPages}
                onClick={() => setValidasiPage((p) => Math.min(validasiTotalPages, p + 1))}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-white px-3.5 py-2 font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-tint-neutral)] active:bg-[var(--color-border-default)] disabled:opacity-55"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
