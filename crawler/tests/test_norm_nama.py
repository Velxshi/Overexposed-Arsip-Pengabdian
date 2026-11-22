import os
import sys
import unittest

# config.py membaca environment saat diimpor, nilainya tidak dipakai di tes ini.
os.environ.setdefault("DATABASE_URL", "postgresql://tes")
os.environ.setdefault("INTERNAL_KEY", "tes")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from loader import norm_nama  # noqa: E402


class NormNamaTest(unittest.TestCase):
    def test_gelar_depan_dan_belakang_dibuang(self):
        self.assertEqual(
            norm_nama("Dr. Mochamad Iqbal Ardimansyah, S.Kom., M.T."),
            "mochamad iqbal ardimansyah",
        )

    def test_nama_berkoma_tidak_terpotong(self):
        self.assertEqual(norm_nama("Nama, Nama"), "nama nama")
        self.assertEqual(norm_nama("Siregar, Budi"), "siregar budi")

    def test_nama_berkoma_dengan_gelar_belakang(self):
        self.assertEqual(norm_nama("Siregar, Budi, S.T., M.Sc."), "siregar budi")

    def test_gelar_depan_bertumpuk(self):
        self.assertEqual(norm_nama("Prof. Dr. Ir. H. Ahmad Fauzi"), "ahmad fauzi")

    def test_gelar_belakang_tanpa_koma(self):
        self.assertEqual(norm_nama("Budi Santoso S.Pd.I M.Si."), "budi santoso")
        self.assertEqual(norm_nama("Siti Aminah Ph.D"), "siti aminah")

    def test_inisial_di_depan_bukan_gelar(self):
        self.assertEqual(norm_nama("M.Iqbal Ardi, S.Kom."), "m iqbal ardi")
        self.assertEqual(norm_nama("M.Ali Rahman"), "m ali rahman")

    def test_aksen_dan_spasi_dirapikan(self):
        self.assertEqual(norm_nama("  José   Müller  "), "jose muller")

    def test_kosong(self):
        self.assertEqual(norm_nama(None), "")
        self.assertEqual(norm_nama(""), "")


if __name__ == "__main__":
    unittest.main()
