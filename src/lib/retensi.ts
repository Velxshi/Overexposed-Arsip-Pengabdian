export type StatusRetensi = "Aktif" | "Inaktif" | "Dimusnahkan";

export interface HasilRetensi {
  tanggalHabisAktif: Date;
  tanggalHabisInaktif: Date;
  status: StatusRetensi;
}

const FORMAT_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})/;

function utcHari(tahun: number, bulan: number, hari: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(tahun, bulan, hari);
  return d;
}

function kabisat(tahun: number): boolean {
  return (tahun % 4 === 0 && tahun % 100 !== 0) || tahun % 400 === 0;
}

// Jam dibuang. Memakai komponen UTC agar sama dengan kolom date Postgres dan CURRENT_DATE di v_arsip.
function keTanggal(nilai: Date | string): Date {
  if (typeof nilai === "string") {
    const cocok = FORMAT_TANGGAL.exec(nilai);
    if (!cocok) throw new RangeError(`Tanggal tidak valid: ${nilai}`);
    const [, t, b, h] = cocok;
    const hasil = utcHari(Number(t), Number(b) - 1, Number(h));
    if (hasil.getUTCMonth() !== Number(b) - 1 || hasil.getUTCDate() !== Number(h)) {
      throw new RangeError(`Tanggal tidak valid: ${nilai}`);
    }
    return hasil;
  }
  if (Number.isNaN(nilai.getTime())) throw new RangeError("Tanggal tidak valid.");
  return utcHari(nilai.getUTCFullYear(), nilai.getUTCMonth(), nilai.getUTCDate());
}

// 29 Februari + n tahun jatuh ke 28 Februari bila tahun tujuan bukan kabisat, seperti make_interval di Postgres.
function tambahTahun(tanggal: Date, tahun: number): Date {
  const target = tanggal.getUTCFullYear() + tahun;
  const bulan = tanggal.getUTCMonth();
  let hari = tanggal.getUTCDate();
  if (bulan === 1 && hari === 29 && !kabisat(target)) hari = 28;
  return utcHari(target, bulan, hari);
}

function cekTahun(nama: string, nilai: number): void {
  if (!Number.isInteger(nilai) || nilai < 0) {
    throw new RangeError(`${nama} harus bilangan bulat tidak negatif: ${nilai}`);
  }
}

/**
 * Status retensi dihitung saat dipanggil, tidak disimpan (PRD 6.3).
 * Pada hari habis retensi, arsip sudah masuk fase berikutnya.
 */
export function hitungRetensi(
  tanggalArsip: Date | string,
  retensiAktifTahun: number,
  retensiInaktifTahun: number,
  sekarang: Date = new Date(),
): HasilRetensi {
  cekTahun("retensiAktifTahun", retensiAktifTahun);
  cekTahun("retensiInaktifTahun", retensiInaktifTahun);

  const mulai = keTanggal(tanggalArsip);
  const hariIni = keTanggal(sekarang).getTime();
  const tanggalHabisAktif = tambahTahun(mulai, retensiAktifTahun);
  const tanggalHabisInaktif = tambahTahun(mulai, retensiAktifTahun + retensiInaktifTahun);

  let status: StatusRetensi;
  if (hariIni < tanggalHabisAktif.getTime()) status = "Aktif";
  else if (hariIni < tanggalHabisInaktif.getTime()) status = "Inaktif";
  else status = "Dimusnahkan";

  return { tanggalHabisAktif, tanggalHabisInaktif, status };
}
