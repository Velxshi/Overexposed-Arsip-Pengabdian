-- v_arsip memakai a.*, jadi dibuang dulu dan dibuat ulang di akhir agar kolom baru ikut.
DROP VIEW "v_arsip";

-- CreateEnum
CREATE TYPE "StatusValidasi" AS ENUM ('Pending', 'Diterima', 'Ditolak');

-- arsip: nomor_surat wajib. Baris lama yang kosong diisi '-' supaya terlihat perlu dilengkapi.
UPDATE "arsip" SET "nomor_surat" = '-' WHERE "nomor_surat" IS NULL OR btrim("nomor_surat") = '';

ALTER TABLE "arsip"
  ALTER COLUMN "nomor_surat" SET NOT NULL,
  ADD COLUMN "status_validasi" "StatusValidasi" NOT NULL DEFAULT 'Pending',
  ADD COLUMN "catatan_validasi" TEXT;

-- log_aktivitas: sebelum migrasi ini hanya ada baris login (AUTH) dan baris modul 4.
ALTER TABLE "log_aktivitas"
  DROP COLUMN "objek_id",
  ADD COLUMN "modul" VARCHAR(10),
  ALTER COLUMN "user_id" DROP NOT NULL,
  ALTER COLUMN "user_nama" DROP NOT NULL;

UPDATE "log_aktivitas" SET "modul" = CASE WHEN "objek" = 'AUTH' THEN 'auth' ELSE '4' END;

-- Nilai lama dari kode login diseragamkan ke nilai baru.
UPDATE "log_aktivitas" SET "aksi" = 'login' WHERE "aksi" IN ('LOGIN_SSO', 'LOGIN_DEV');
UPDATE "log_aktivitas" SET "objek" = 'sso' WHERE "objek" = 'AUTH';

ALTER TABLE "log_aktivitas" ALTER COLUMN "modul" SET NOT NULL;

-- v_arsip: label 'Habis Retensi' diganti 'Dimusnahkan'.
CREATE VIEW "v_arsip" AS
SELECT
  a.*,
  k.kode AS kategori_kode,
  k.nama AS kategori_nama,
  (a.tanggal_arsip + make_interval(years => a.retensi_aktif_tahun))::date AS tanggal_habis_aktif,
  (a.tanggal_arsip + make_interval(years => a.retensi_aktif_tahun + a.retensi_inaktif_tahun))::date AS tanggal_habis_inaktif,
  CASE
    WHEN CURRENT_DATE < (a.tanggal_arsip + make_interval(years => a.retensi_aktif_tahun))::date THEN 'Aktif'
    WHEN CURRENT_DATE < (a.tanggal_arsip + make_interval(years => a.retensi_aktif_tahun + a.retensi_inaktif_tahun))::date THEN 'Inaktif'
    ELSE 'Dimusnahkan'
  END AS status
FROM "arsip" a
JOIN "kategori" k ON k.id = a.kategori_id;
