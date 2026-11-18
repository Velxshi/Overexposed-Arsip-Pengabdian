# PRD: Modul 4 (Arsip Prodi) dan Modul 7 (Data Tridarma Dosen)

Dokumen ini adalah acuan untuk Claude Code dan pengembang. Tujuannya menjelaskan apa yang dibangun, keputusan yang sudah diambil, dan keputusan yang belum. **Bagian bertanda "Usulan" belum disetujui tim. Jangan diperlakukan sebagai keputusan final.** Bagian "Keputusan terbuka" harus ditanyakan ke pemilik proyek, bukan ditebak.

Versi: 1.4. Berdasarkan ERD versi 6.

| Versi | Tanggal    | Perubahan                                                                                                                                                                                                                                                      |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0   | (awal)     | Versi awal.                                                                                                                                                                                                                                                    |
| 1.1   | 2026-11-17 | Crawler diputuskan di Render Web Service gratis, on-demand, tanpa cron dan tanpa monitor ping. Alur sinkron diperjelas (warm-up, async, status di database). Aturan 7 hari berlaku untuk semua peran dan tidak bisa dipaksa. Keputusan deploy crawler ditutup. |
| 1.2   | 2026-11-17 | Role admin di bagian 8.1 diganti Staff Kaprodi (rute `/api/staff-kaprodi/sinkron`). Catatan "Admin belum ada di SSO" dihapus, pertanyaan hak Kaprodi ditambahkan ke bagian 12.                                                                                 |
| 1.3   | 2026-11-17 | Pengisian `sinta_id` untuk Staff Kaprodi dibuat opsional (5.1, 8.1). Pertanyaan terbuka nomor 1 ditutup.                                                                                                                                                       |
| 1.4   | 2026-11-17 | Sesi disimpan di cookie terenkripsi (refresh token dienkripsi dengan kunci dari `SESSION_SECRET`). Tidak ada tabel sesi. Aturan refresh diperjelas dan risiko pencabutan sesi ditambahkan ke bagian 12. |

---

## 1. Ringkasan

Proyek kelas Sistem Informasi RPL (UPI Kampus Cibiru) berisi 10 modul yang dijadikan microservice dengan login SSO bersama (SACIBIRU). Tim ini memegang dua modul:

- **Modul 4, Arsip Prodi.** Web untuk mengelola arsip surat dan dokumen program studi.
- **Modul 7, Data Tridarma Dosen.** Mengumpulkan data penelitian, pengabdian, publikasi, dan pengajaran dosen. Data penelitian dan publikasi diambil dari SINTA publik lewat crawler.

Kedua modul berada di **satu aplikasi Next.js dengan satu database**. Pengembang yang memakai Claude Code ini memegang **back-end** (API, database, integrasi SSO, layanan crawler). Front-end dikerjakan orang lain di repo yang sama.

## 2. Tech stack

| Bagian             | Pilihan                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Aplikasi           | Next.js (monolith: front-end dan back-end dalam satu repo)                                              |
| Database           | Postgres di Neon                                                                                        |
| ORM dan migrasi    | Prisma (Prisma memiliki skema)                                                                          |
| Verifikasi JWT SSO | `jose`                                                                                                  |
| Crawler            | Python, dibungkus layanan FastAPI terpisah di folder `crawler/`                                         |
| Library Python     | `requests`, `beautifulsoup4`, `psycopg` (v3)                                                            |
| Deploy crawler     | **Render Web Service paket gratis** (lihat bagian 8).                                                   |
| Deploy Next.js     | **Belum diputuskan.** Jangan mengasumsikan Vercel atau VPS. Sediakan `Dockerfile` untuk layanan Python. |

Database sebelumnya MariaDB (dump `db_belajarcrawling`). Sekarang Postgres, jadi kode dan skema lama perlu disesuaikan (lihat bagian 9).

## 3. Batas tanggung jawab

**Ada di repo ini:** Modul 4 dan Modul 7, termasuk sisi klien SSO (login dan callback) dan layanan crawler.

**Tidak ada di repo ini:** server SSO, tabel user SSO, dan password. Semua itu ada di repo dan database SSO yang terpisah. Modul ini tidak boleh menyimpan password atau membuat tabel user.

Relasi ke pengguna SSO memakai `user_id` (UUID, nilai klaim `sub`) **tanpa foreign key** lintas database.

## 4. Integrasi SSO (sisi klien)

SSO memakai OAuth 2.0 Authorization Code, PKCE (S256), dan access token JWT RS256. Alurnya:

1. Pengguna klik kartu modul di Menu Utama SSO, lalu SSO mengalihkan ke `launch_url` modul (`/sso/login`).
2. Modul membuat `state` dan PKCE, menyimpannya di cookie `httpOnly`, lalu mengalihkan ke `{SSO}/api/sso/authorize`.
3. Setelah login, SSO mengalihkan ke `redirect_uri` (`/auth/callback`) membawa `code` dan `state`.
4. Modul memastikan `state` cocok, lalu dari backend menukar `code` ke `{SSO}/api/sso/token` (dengan `client_secret` dan `code_verifier`).
5. Modul memverifikasi JWT dengan `jose` (`algorithms: ["RS256"]`, `issuer`, `audience`) dan kunci publik dari `{SSO}/api/sso/jwks`.
6. Modul membuat sesi lokal berupa cookie `httpOnly`, `secure`, `sameSite=lax` yang berisi refresh token **terenkripsi** (AES-256-GCM, kunci turunan dari `SESSION_SECRET`). Tidak ada tabel sesi di database.

Aturan penting:

- Klaim token: `sub`, `name`, `email`, `nip`, `role`, `iss`, `aud`, `exp`. Pakai `sub` sebagai kunci akun.
- Umur access token 15 menit, refresh token 30 hari dan **dirotasi** setiap dipakai. Setiap refresh yang berhasil harus menulis ulang cookie dengan refresh token terbaru. Memakai token lama membatalkan seluruh rantai. Karena sesi disimpan di cookie, tidak ada kunci di server untuk mencegah dua refresh paralel. Refresh hanya dilakukan saat access token habis, dan kegagalan `invalid_grant` diarahkan ke login ulang.
- Umur sesi lokal sama dengan access token. Saat habis, panggil `/token` dengan `grant_type=refresh_token`. Bila `invalid_grant`, hapus cookie sesi dan arahkan ke `/sso/login`.
- Logout: hapus cookie sesi lokal, lalu alihkan ke `{SSO}/api/sso/logout` dengan `client_id` dan `post_logout_redirect_uri`.
- `client_secret` hanya di environment server. Tidak boleh berawalan `NEXT_PUBLIC_`, tidak boleh masuk repo.

Role dari SSO: **`Kaprodi`, `Dosen`, `Staff Kaprodi`, `Mahasiswa`.** Catatan: dokumen SSO v1.0 masih menyebut `Admin` dan belum memuat `Staff Kaprodi` dan `Mahasiswa`. Perubahan itu harus dilakukan oleh tim SSO. Sampai itu selesai, login dengan role baru bisa ditolak SSO. Role `Staff Kaprodi` yang dipakai di bagian 8.1 sudah termasuk dalam daftar role di atas.

Variabel lingkungan: `SSO_URL` (tanpa `/` akhir, harus sama dengan klaim `iss`), `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`, `SESSION_SECRET`.

`SESSION_SECRET` dipakai untuk mengenkripsi refresh token. Mengubahnya membuat semua sesi aktif tidak bisa dibaca, sehingga semua user harus login ulang. Nilainya berbeda untuk setiap aplikasi dan tidak dibagi antar modul.

Pendaftaran modul ke pengelola SSO (`client_id`, `launch_url`, `redirect_uri`, role yang boleh masuk) dilakukan manual oleh tim. Karena Modul 4 dan 7 satu aplikasi, cukup satu `client_id`.

## 5. Modul 7: Data Tridarma Dosen

### 5.1 Tabel `dosen` dan pendaftaran dosen

Tabel `dosen` **hanya berisi pengguna yang sudah mengisi `sinta_id`**. Mahasiswa tidak pernah masuk tabel ini. Staff Kaprodi masuk hanya bila mengisi `sinta_id`.

Alur login pertama:

1. Pengguna login lewat SSO. Bila role Mahasiswa, tidak ada baris `dosen` dan tidak diminta `sinta_id`.
2. Bila role Kaprodi atau Dosen dan belum ada baris `dosen` dengan `user_id = sub`, pengguna diminta mengisi `sinta_id`. Untuk Staff Kaprodi, pengisian `sinta_id` **boleh dilewati**. Staff Kaprodi yang melewati tidak punya baris `dosen`, dan bisa mengisi `sinta_id` kapan saja nanti.
3. Setelah diisi, baris `dosen` dibuat dengan `user_id = sub`, lalu crawler mengisi `nama`, `afiliasi`, `departemen`, skor, metrik, dan data lain dari SINTA.
4. Login berikutnya mencari baris `dosen` lewat `user_id`.

Aturan:

- `dosen.user_id` wajib dan unik. `dosen.sinta_id` wajib dan unik.
- **Tidak ada `email` dan `nip` di tabel `dosen`.** Hubungan ke SSO hanya lewat `user_id`. Tidak ada pencocokan nama ke SSO.
- `dosen.nama` dan `nama_normal` tetap berasal dari SINTA, karena `nama_normal` dipakai mencocokkan nama ketua dan anggota di `kegiatan_anggota` (juga dari SINTA). Jangan menimpanya dengan nama SSO. Nama tampilan di aplikasi diambil dari sesi SSO.
- Tiga baris `dosen` di dump lama adalah data uji dari masa sebelum SSO. Buang, jangan di-seed.

### 5.2 Sumber data: SINTA publik

SINTA diambil **tanpa login**. Halaman publik hanya menampilkan sekitar 10 item pertama per tab, jadi data bisa terpotong (dicatat di `crawl_log.terpotong`). Login SINTA dengan akun dosen masih berupa opsi, belum dicoba, dan butuh persetujuan dosen. **Jangan diimplementasikan.**

Data yang diambil per dosen: profil (nama, afiliasi, departemen), skor SINTA, metrik (Scopus, Google Scholar, WOS), dan 8 tab: Scopus, Garuda, Google Scholar, RAMA, Penelitian, Pengabdian, IPR (HKI), Buku.

### 5.3 Aturan pemrosesan data (sudah ditetapkan)

- **Anti-dobel.** Kunci dibuat dari teks yang dinormalisasi (huruf kecil, tanpa tanda baca), lalu di-hash md5. `publikasi.judul_hash = md5(norm(judul))`. `kegiatan.kunci = md5(jenis | judul | tahun)`. `iprs.kunci` dari nomor permohonan, atau judul dan tahun bila kosong. `buku.kunci` dari ISBN, atau judul dan tahun bila kosong.
- **Upsert.** Crawl ulang tidak menambah baris ganda, hanya memperbarui.
- **Publikasi.** `sitasi` memakai nilai tertinggi (`GREATEST`). Kolom lain diisi hanya bila masih kosong (`COALESCE`).
- **Urutan sumber saat simpan:** Scopus, Garuda, Google Scholar SINTA, RAMA. Nilai `publikasi_dosen.source`: `sinta_scopus`, `sinta_garuda`, `sinta_googlescholar`, `sinta_rama`.
- **Ketua dan anggota kegiatan.** `nama` disimpan apa adanya, `nama_normal` hasil normalisasi. Dicocokkan ke `dosen.nama_normal` hanya bila cocok tepat satu baris. Yang tidak cocok tetap tersimpan dengan `dosen_id` NULL.
- **Gelar dibuang saat normalisasi** (Dr., Prof., S.Kom., M.T., dst).
- **Tab gagal tidak menimpa data lama.** Kegagalan dicatat di `crawl_log`.
- **Status sinkron (`sync_status`).** `IN_PROGRESS` saat berjalan. `SUCCESS` (dan `last_synced_at` diisi) bila semua tab berhasil. `PARTIAL` bila sebagian gagal. `FAILED` bila semua gagal. Sisa `IN_PROGRESS` yang sudah lama dianggap `FAILED`.
- **Aturan 7 hari.** Dosen diproses bila belum pernah sinkron, atau `last_synced_at` sudah lebih dari 7 hari lalu. **Aturan ini berlaku untuk semua peran, termasuk Staff Kaprodi. Tidak ada opsi paksa.** Dosen yang masih dalam 7 hari dilewati dan dicatat sebagai dilewati. Pengecualian untuk status `FAILED` atau `PARTIAL` belum diputuskan (lihat bagian 12).
- **Jeda.** Sekitar 3 detik antar request ke SINTA dan jeda acak antar dosen (target dalam ringkasan awal). Kode saat ini baru 1,5 detik per tab. Putuskan angkanya, lalu samakan.

### 5.4 Pengajaran (bidang tridarma ketiga)

Mengoleksi kinerja dosen di bidang pengajaran. Berkas berupa **link saja** (misalnya Google Drive), tidak ada upload.

- `matkul`: daftar mata kuliah (`kode` unik, `nama`, `sks`).
- `kelas`: mata kuliah yang diampu dosen pada tahun ajaran dan semester tertentu (`matkul_id`, `dosen_id`, `tahun_ajaran`, `semester` Ganjil/Genap). Sebaiknya unik per (`matkul_id`, `dosen_id`, `tahun_ajaran`, `semester`).
- `berkas_pengajaran`: berkas per kelas. Kolom `jenis` berupa enum: **RPS, Slide, UTS, UAS, Kuis, Presensi, Nilai, Modul**. Satu kelas boleh punya lebih dari satu berkas dengan jenis sama (misalnya dua kuis).
- Tidak ada tabel kategori berkas, dan **tidak ada kolom retensi** di berkas pengajaran (lihat keputusan terbuka).

### 5.5 Fase berikutnya (belum dikerjakan, jangan dibangun dulu)

- Grafik profil SINTA ("Latest number of publications" per tahun dan "Article Quartile"). Bisa dihitung dari `publikasi` dan `publikasi_dosen` (filter `source = 'sinta_scopus'`), tetapi hanya akurat untuk dosen dengan 10 artikel Scopus atau kurang, karena batas SINTA publik.
- Rekap penilaian tridarma dengan kolom TS, TS-1, TS-2 yang diisi manual oleh Staff Kaprodi per tahun (bukan dihitung dari crawling). Tabel "Publikasi Ilmiah Hasil Penelitian DTPS" punya 10 jenis publikasi.
- `kutipan_tahun` (sitasi per tahun dari SerpAPI) sudah dirancang tetapi tidak dipakai, karena alur sekarang hanya SINTA.

## 6. Modul 4: Arsip Prodi (Ruang Arsip Digital)

Web untuk mengelola arsip surat dan dokumen. Menu: Dashboard, Input Arsip, Daftar Arsip, Kategori, Users, Log Aktivitas, Profil Saya, Logout.

- Berkas **tidak diupload**, hanya disimpan sebagai link (`link_berkas`). Lokasi fisik dan ikon kategori sudah dihapus dari desain.
- Modul 4 **tidak punya tabel user**. Halaman Profil Saya diambil dari sesi SSO.
- `kategori`: `kode` unik (contoh KEU), `nama`, `retensi_aktif_tahun`, `retensi_inaktif_tahun`, `keterangan`.
- `arsip`: `nomor_arsip` (unik, **dibuat otomatis oleh aplikasi, format belum ditentukan**), `judul`, `kategori_id`, `tanggal_arsip`, `nomor_surat`, `pencipta_unit`, `retensi_aktif_tahun` dan `retensi_inaktif_tahun` (**salinan dari kategori saat dibuat**), `link_berkas`, `keterangan`, `dibuat_oleh` (`sub` SSO), `created_at`, `updated_at`.
- `log_aktivitas`: `user_id` (`sub` SSO), `user_nama` (**salinan nama**, supaya log tetap terbaca bila user dihapus di SSO), `aksi`, `objek` (arsip atau kategori), `objek_id`, `detail`, `created_at`.
- Kategori yang masih dipakai arsip **tidak bisa dihapus** (`ON DELETE RESTRICT`). Retensi disalin ke arsip supaya perubahan kategori tidak mengubah arsip lama.
- **View `v_arsip`** menggabungkan arsip dan kategori, dengan `tanggal_habis_aktif`, `tanggal_habis_inaktif`, dan `status`. Status **dihitung saat dibaca, tidak disimpan**: _Aktif_ (sebelum habis retensi aktif), _Inaktif_ (habis aktif, belum habis inaktif), _Habis Retensi_ (habis keduanya). Label status masih usulan.
- Data awal kategori: ADM Arsip Administrasi (2/3), HRD Arsip HRD (2/5), KEU Arsip Keuangan (2/8), OPS Arsip Operasional (2/3), PRG Arsip Program (2/3), RND Arsip RnD (3/5), SLS Arsip Sales (2/3), TI Arsip Teknologi Informasi (2/3). Angka dalam kurung adalah retensi aktif/inaktif (tahun).

## 7. Model data

**Modul 7:** `dosen`, `sinta_skor` (PK dosen_id+label), `sinta_metrik` (PK dosen_id+label; kolom scopus, gscholar, wos), `crawl_log`, `publikasi`, `publikasi_dosen` (PK publikasi_id+dosen_id+source), `kegiatan` (jenis: penelitian/pengabdian), `kegiatan_anggota` (PK kegiatan_id+nama_normal, `dosen_id` boleh NULL), `iprs`, `iprs_dosen`, `buku`, `buku_dosen`, `matkul`, `kelas`, `berkas_pengajaran`.

**Modul 4:** `kategori`, `arsip`, `log_aktivitas`, view `v_arsip`.

Aturan relasi: relasi antar tabel dalam database memakai foreign key (cascade untuk tabel penghubung dosen; `kegiatan_anggota.dosen_id` menjadi NULL bila dosen dihapus; `arsip.kategori_id` RESTRICT). Kolom `user_id`, `dibuat_oleh`, dan `log_aktivitas.user_id` bertipe `CHAR(36)` atau UUID **tanpa FK**.

## 8. Layanan crawler (Python)

Layanan FastAPI kecil di `crawler/`, di-deploy sebagai **Render Web Service paket gratis**, dipanggil dari route handler Next.js lewat HTTP.

Sifat layanan:

- **On-demand.** Tidak ada cron job dan tidak ada monitor ping. Sinkron hanya dipicu manual oleh user, dan data SINTA jarang berubah.
- Paket gratis Render tidur setelah 15 menit tanpa request masuk, dan bangun sekitar satu menit. Sinkron pertama setelah lama tidak dipakai akan terasa lambat. Ini diterima.
- Kuota gratis Render: 750 jam per bulan per workspace, dibagi untuk semua Web Service gratis di workspace itu. Cek ulang angka ini di dokumentasi Render sebelum deploy.
- Sinkron 8 dosen memakan sekitar 3–6 menit (15–40 detik per dosen). Karena itu crawling berjalan di background, tidak di dalam request.

Alur sinkron:

1. Saat halaman tombol sinkron dibuka, frontend memanggil route Next.js yang meneruskan `GET /health` ke layanan Python. Tombol dinonaktifkan dan muncul indikator "Server sedang bersiap..." sampai layanan membalas `200 OK`.
2. User menekan tombol. Route handler Next.js memeriksa sesi dan hak (8.1), lalu menerapkan aturan 7 hari (5.3). Dosen yang masih dalam 7 hari dilewati.
3. Route handler mengubah status secara atomik: `updateMany` dengan kondisi `sync_status != IN_PROGRESS`. Bila tidak ada baris berubah, tolak dengan pesan "sedang berjalan".
4. Route handler memanggil `POST {CRAWLER_URL}/sync` dengan body `{ "sinta_id": "..." }` (kosong untuk semua dosen yang lolos aturan 7 hari) dan header `X-Internal-Key`, lalu membalas `202 Accepted` tanpa menunggu.
5. Layanan Python menjalankan crawl di background dan **menulis langsung ke database** memakai logika upsert. Progres dan status akhir disimpan di database, bukan di memori, supaya tetap terbaca walau layanan restart. Status akhir `SUCCESS`, `PARTIAL`, atau `FAILED`.
6. Frontend memeriksa `sync_status` lewat route Next.js secara berkala (misalnya tiap 5–10 detik) sampai status tidak lagi `IN_PROGRESS`. Polling ini juga membuat layanan tetap terjaga selama sinkron berjalan.

Aturan:

- Crawling **tidak boleh dijalankan di dalam request**.
- Layanan Python **tidak boleh publik**. Wajib header rahasia `X-Internal-Key` (nilai di `INTERNAL_KEY`).
- Browser **tidak boleh memanggil layanan Python langsung**. Semua lewat route Next.js, supaya `INTERNAL_KEY` tidak pernah sampai ke klien.
- Hanya satu crawl berjalan pada satu waktu (antrean sederhana), supaya SINTA tidak kebanjiran. Penanganan konflik antrean mengikuti bagian 12 nomor 8–9.
- Sisa `IN_PROGRESS` yang sudah lama ditandai `FAILED` saat layanan menyala. Jangan dijalankan di setiap request.
- Layanan Python hanya meng-UPDATE baris `dosen` yang sudah ada (dibuat oleh Next.js saat login pertama). Ia tidak membuat baris `dosen`.
- Layanan Python memakai `DATABASE_URL` berupa URL pooled.

Endpoint layanan: `GET /health`, `POST /sync`.

Variabel lingkungan:

- Next.js: `CRAWLER_URL` (alamat layanan Render), `INTERNAL_KEY`.
- Layanan Python: `INTERNAL_KEY` (nilai sama dengan Next.js), `DATABASE_URL` (URL langsung), `PORT` (diisi Render).
- Nilai rahasia dibuat sendiri dan tidak pernah ditulis di repo atau di chat. File `.env` wajib di-gitignore.

### 8.1 Hak menjalankan crawling

| Peran         | Semua dosen | Satu dosen (pilih) | Diri sendiri                      |
| ------------- | ----------- | ------------------ | --------------------------------- |
| Staff Kaprodi | ya          | ya                 | ya, bila sudah mengisi `sinta_id` |
| Dosen         | tidak       | tidak              | ya                                |
| Mahasiswa     | tidak       | tidak              | tidak (tidak punya baris `dosen`) |

- Pemeriksaan hak dilakukan di Next.js (route handler), sebelum memanggil layanan Python. Layanan Python hanya memeriksa `X-Internal-Key`.
- Route Next.js: `POST /api/dosen/sinkron` untuk diri sendiri (`sinta_id` diambil dari baris dosen yang user_id-nya sama dengan sub sesi), dan `POST /api/staff-kaprodi/sinkron` untuk Staff Kaprodi (body berisi `sinta_id` opsional; kosong berarti semua dosen).
- Route `POST /api/dosen/sinkron` menolak bila baris `dosen` belum ada, dengan pesan untuk mengisi `sinta_id` dulu.
- Aturan 7 hari berlaku untuk semua peran, termasuk Staff Kaprodi. Staff Kaprodi tidak bisa memaksa sinkron sebelum 7 hari.
- Semua permintaan crawl, baik satu maupun semua dosen, masuk antrean yang sama dan hanya satu yang berjalan dalam satu waktu.

## 9. Porting MariaDB ke Postgres (Neon) dan Prisma

**Kode Python (`sinta_to_db.py` menjadi `loader.py`):**

| MariaDB                                   | Postgres                                                           |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `pymysql`, `DictCursor`                   | `psycopg` v3, `dict_row`                                           |
| `INSERT ... ON DUPLICATE KEY UPDATE`      | `INSERT ... ON CONFLICT (kolom_unik) DO UPDATE SET k = EXCLUDED.k` |
| `INSERT IGNORE`                           | `INSERT ... ON CONFLICT DO NOTHING`                                |
| `VALUES(kolom)` di dalam update           | `EXCLUDED.kolom`                                                   |
| `IF(a, b, c)`                             | `CASE WHEN a THEN b ELSE c END`                                    |
| `NOW() - INTERVAL %s DAY`                 | `NOW() - (%s * INTERVAL '1 day')`                                  |
| `UPDATE ... JOIN` (di `backfill_anggota`) | `UPDATE ... SET ... FROM ... WHERE ...`                            |
| Backtick                                  | Tanda kutip ganda atau tanpa pembungkus                            |
| `DB_CONFIG` dengan `root` tanpa password  | `DATABASE_URL` dari environment, `sslmode=require`                 |
| `main()` dan argparse                     | fungsi `sync_dosen(sinta_id)` untuk FastAPI                        |

Placeholder `%s`, `COALESCE`, `GREATEST`, `NULLIF`, `CONCAT_WS` tetap bisa dipakai. Uji penulisan nilai string ke kolom enum Postgres.

**Skema Prisma:**

- Kolom `publikasi.sumber` (tipe SET) **dihapus**. Nilainya dihitung dari `publikasi_dosen.source` saat dibaca. Fungsi `sinkron_sumber` di Python ikut dihapus.
- `kegiatan.updated_at`: Prisma `@updatedAt` hanya bekerja dari sisi Prisma. Dari Python, isi `updated_at = NOW()` secara eksplisit.
- Tipe: `tinyint` menjadi `SmallInt`, `datetime` menjadi `DateTime`, `enum` menjadi `enum` Prisma, `user_id` menjadi `String` (atau `@db.Uuid`).
- Pakai `@@map` dan `@map` agar nama tabel dan kolom di database tetap `snake_case`, karena SQL di Python memakai nama itu.
- Migrasi memakai URL koneksi langsung (non-pooled); aplikasi memakai URL pooled. Variabel: `DATABASE_URL` dan `DIRECT_URL`.
- **Prisma adalah satu-satunya pemilik skema.** Setiap perubahan skema harus diikuti pengecekan SQL di `crawler/`.

## 10. Struktur folder (usulan)

```
sacibiru-modul/
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ src/
│  ├─ app/
│  │  ├─ sso/login/route.ts
│  │  ├─ auth/callback/route.ts
│  │  └─ api/
│  │     ├─ crawler/health/route.ts
│  │     ├─ dosen/sinta-id/route.ts
│  │     ├─ dosen/sinkron/route.ts
│  │     ├─ dosen/sinkron/status/route.ts
│  │     ├─ staff-kaprodi/sinkron/route.ts
│  │     ├─ arsip/...
│  │     ├─ kategori/...
│  │     ├─ pengajaran/...
│  │     └─ tridarma/...
│  ├─ lib/
│  │  ├─ db.ts
│  │  ├─ session.ts
│  │  ├─ sso.ts
│  │  └─ crawler-client.ts
│  └─ middleware.ts
├─ crawler/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ sinta.py
│  │  ├─ loader.py
│  │  └─ config.py
│  ├─ requirements.txt
│  ├─ Dockerfile
│  └─ .env.example
├─ .env.example
└─ package.json
```

Di `crawler/app/`, `loader.py` mengimpor `sinta.py` dengan `import sinta`. Nama file dan impor harus sama.

**Batas kerja back-end di repo bersama:** pemilik back-end memegang `prisma/`, `src/app/api/**`, `src/app/sso/**`, `src/app/auth/**`, `src/lib/**`, `src/middleware.ts`, dan `crawler/`. File UI dan komponen milik front-end, jangan diedit tanpa diminta.

## 11. Masalah yang sudah diketahui di kode crawler yang ada

Temuan dari tinjauan `sinta.py` dan `sinta_to_db.py` (kode ini sudah terbukti hasilnya baik di JSON):

1. Jeda antar tab 1,5 detik, sedangkan target sekitar 3 detik.
2. `parse_profile_overview`: angka seperti `1.234` diperlakukan sebagai desimal. Bila SINTA memakai titik sebagai pemisah ribuan, skor akan keliru. Cek dengan HTML asli.
3. `simpan_kegiatan` memanggil `muat_peta_dosen` untuk setiap baris, yaitu satu query tambahan per kegiatan. Pindahkan ke luar loop.
4. Untuk ID yang tidak ada (404), `fetch` mengembalikan `None` dan pesannya menjadi "Gagal menghubungi SINTA". Retry sekitar 12 detik tidak perlu untuk 404.
5. `norm_nama` membuang semua teks setelah koma pertama. Nama berformat "Nama, Nama" bisa terpotong.

## 12. Keputusan terbuka (tanyakan ke pemilik proyek)

1. _(Sudah diputuskan: pengisian `sinta_id` untuk Staff Kaprodi opsional. Lihat 5.1.)_
2. **`kelas` per tahun ajaran atau per mata kuliah saja.** Saat ini per kelas (mata kuliah + dosen + tahun ajaran + semester).
3. **Hak crawl Kaprodi.** Bagian 8.1 memberi Staff Kaprodi hak sinkron semua dosen dan satu dosen. Apakah role `Kaprodi` juga mendapat hak yang sama, atau hanya Staff Kaprodi?
4. **Role dan hak akses lainnya.** Siapa boleh melihat dan mengubah apa (misalnya siapa yang boleh mengakses Modul 4, siapa yang boleh melihat data dosen lain, siapa yang menyetujui) **belum ditetapkan**. Jangan menebak. Tanyakan sebelum membuat otorisasi.
5. **Format `nomor_arsip`** otomatis.
6. **Label status arsip** (Aktif, Inaktif, Habis Retensi masih usulan).
7. **Deploy Next.js.** Tempat deploy aplikasi Next.js belum diputuskan. (Deploy crawler sudah diputuskan: Render, lihat bagian 8.)
8. **Jeda crawling** (1,5 atau 3 detik).
9. **Konflik antrean.** Saat "sinkron semua" sedang berjalan, permintaan crawl satu dosen ditolak dengan pesan "sedang berjalan", atau masuk antrean?
10. **Dosen memicu crawl dirinya saat Staff Kaprodi sedang sinkron semua.** Apakah tetap ditolak atau diantrekan?
11. **Dosen dengan status `FAILED` atau `PARTIAL`.** Boleh diulang sebelum 7 hari, atau tetap menunggu 7 hari seperti dosen lain?
12. **Pencabutan sesi.** Karena sesi disimpan di cookie, akun yang dicabut admin SSO baru terasa saat refresh berikutnya gagal. Diterima untuk skala tugas ini. Perlu persetujuan tim.

## 13. Di luar cakupan

- Server SSO dan tabel user SSO.
- Upload file (semua berkas berupa link).
- Login SINTA dengan akun dosen.
- Pengisian rekap TS, TS-1, TS-2 dan grafik profil (fase berikutnya, lihat 5.5).
- Front-end dan UI.
- SerpAPI / Google Scholar lewat API (tidak dipakai lagi).
- Cron job dan monitor uptime untuk layanan crawler.
- Tabel sesi di database. Sesi disimpan di cookie terenkripsi.

## 14. Urutan pengerjaan (usulan)

1. `schema.prisma` dari ERD versi 6 dan migrasi ke Neon.
2. Sisi klien SSO: `/sso/login`, `/auth/callback`, sesi, refresh, logout.
3. Alur login pertama dan pengisian `sinta_id`.
4. `loader.py` versi Postgres dan layanan FastAPI (`/health`, `/sync`), termasuk pengecekan 7 hari, antrean satu job, dan pembersihan `IN_PROGRESS` yang tertinggal. Lalu route Next.js `POST /api/dosen/sinkron`, `POST /api/staff-kaprodi/sinkron`, dan route status.
5. API Modul 4 (kategori, arsip, `v_arsip`, log aktivitas).
6. API Modul 7 (tridarma, lalu pengajaran).
7. Tinjauan keamanan sisi SSO, lalu tes untuk logika murni (normalisasi nama, hash, status retensi, upsert, aturan 7 hari).