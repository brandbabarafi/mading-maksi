# Mading Maksi

Papan patungan makan siang untuk satu ruangan. Satu orang menalangi, aplikasi menghitung bagian tiap orang (termasuk ongkir, biaya layanan, pajak, dan promo), lalu tiap orang mencentang sendiri kalau sudah bayar, boleh dengan foto bukti transfer.

Semuanya di GitHub, tanpa server lain:

- **Halaman:** GitHub Pages, `https://brandbabarafi.github.io/mading-maksi/`
- **Data:** satu file `data.json` di repo publik `brandbabarafi/mading-maksi-data`, ditulis langsung dari browser lewat GitHub API.
- **Privasi:** yang terbaca publik hanya nama panggilan, nama resto, tanggal, nominal, dan status centang. Rincian menu dan foto bukti **dienkripsi** (AES-GCM) sebelum disimpan; kuncinya hanya ada di kode ruangan.
- **AI:** Gemini untuk membaca foto struk dan teks pesanan, Groq sebagai cadangan teks. Kuncinya ada di dalam kode ruangan.

Spesifikasi lengkap (BRD, PRD, ERD) ada di dokumen Claude "Mading Maksi — BRD, PRD & ERD".

## Cara pakai

1. **Yang nalangin** menekan **+ Patungan**, mengisi menu tiap orang (atau biar AI yang isi dari chat atau foto struk), lalu ongkir dan biaya lain. Bagian tiap orang langsung terhitung.
2. **Yang lain** transfer ke yang nalangin seperti biasa.
3. **Centang namamu** di mading, tandai sudah bayar, dan lampirkan bukti kalau mau. Patungan otomatis pindah ke "Sudah lunas" begitu semua mencentang.

Melihat mading dan saldo tidak perlu apa-apa. Membuat patungan, mencentang, dan mengelola anggota perlu **kode ruangan**: satu teks `MM1…` yang ditempel sekali per perangkat.

## Setup (sekali, oleh admin)

1. **GitHub Pages:** di repo ini, buka **Settings → Pages → Source: GitHub Actions**, lalu jalankan ulang workflow **Publish ke GitHub Pages** di tab Actions.
2. Buka mading, ketuk **?** → **buka Setup** (atau langsung `…/mading-maksi/#/setup`), lalu ikuti 3 langkah di sana:
   - Buat repo publik kosong **`mading-maksi-data`**.
   - Buat **fine-grained token** di https://github.com/settings/personal-access-tokens/new. Repository access: hanya `mading-maksi-data`. Permissions: **Contents → Read and write**. Expiration: "No expiration" boleh (tidak perlu diperbarui), asal token segera dicabut kalau kode bocor; lebih aman pilih 1 tahun.
   - (Opsional) kunci Gemini gratis dari https://aistudio.google.com/apikey.
3. Tempel token dan kunci, tekan **Buat kode ruangan**. Bagikan kode itu ke anggota ruangan saja.

Token kedaluwarsa, bocor, atau mau ganti kode? Buka Setup lagi, isi token baru, dan tempel **kode lama** di kolom "Kode lama" supaya kunci enkripsinya tetap sama dan data lama tetap terbaca.

## Jalankan di komputer sendiri

```bash
npm run dev
```

Buka `http://localhost:8787/?demo` untuk mode demo (data hanya di browser), atau `http://localhost:8787/` untuk memakai data GitHub asli. Tes: `npm test`.

## Pengaturan

Di `public/config.js`:

| Nama | Bawaan | Arti |
| --- | --- | --- |
| `DATA_REPO` | `brandbabarafi/mading-maksi-data` | Repo tempat `data.json`. Kosongkan untuk mode demo. |
| `PEMBULATAN` | `100` | Tagihan dibulatkan ke atas ke kelipatan ini (Rp). Selisihnya untuk penalang. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model Gemini. Ganti kalau Google memensiunkannya. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model Groq cadangan untuk teks. |

## Struktur

| Path | Isi |
| --- | --- |
| `public/` | Seluruh aplikasi (tanpa framework, tanpa build). Folder ini yang dipublish ke GitHub Pages. |
| `public/hitung.js` | Rumus patungan |
| `public/gudang.js` | Baca dan tulis `data.json` lewat GitHub API, termasuk mengulang otomatis kalau dua orang menyimpan bersamaan |
| `public/sandi.js` | Enkripsi AES-GCM dan format kode ruangan |
| `public/ai.js` | Panggilan Gemini dan Groq; AI hanya membaca menu dan biaya, tidak menghitung uang |
| `public/app.js` | Tampilan dan alur |
| `scripts/serve.js` | Server lokal untuk `npm run dev` |
| `.github/workflows/pages.yml` | Publish otomatis ke GitHub Pages setiap push ke `main` |

## Batasan yang perlu diketahui

- **Kode ruangan = kunci rumah.** Isinya token GitHub-mu (hanya bisa menulis ke repo data) dan kunci enkripsi. Token tanpa kedaluwarsa tetap berlaku sampai dicabut di https://github.com/settings/personal-access-tokens. Bagikan hanya ke anggota. Kalau bocor, buat token baru, cabut token lama di GitHub, lalu buat ulang kode lewat Setup.
- **Pengunjung tanpa kode** membaca lewat API GitHub tanpa login (batas 60 permintaan per jam per jaringan, tapi permintaan "tidak berubah" tidak dihitung). Kalau batasnya habis, data diambil dari salinan GitHub yang bisa tertinggal sampai 5 menit.
- **Foto bukti** dihapus dari repo setelah 14 hari atau saat centang dibatalkan. Riwayat git tetap menyimpan versi terenkripsinya, yang hanya bisa dibuka dengan kode ruangan.
- **Kunci AI** ada di dalam kode ruangan, jadi siapa pun yang memegang kode bisa melihatnya. Pakai kunci tier gratis.
