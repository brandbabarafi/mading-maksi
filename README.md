# Mading Maksi

Papan patungan makan siang untuk satu ruangan. Satu orang menalangi, aplikasi menghitung bagian tiap orang (termasuk ongkir, biaya layanan, pajak, dan promo), lalu tiap orang mencentang sendiri kalau sudah bayar, boleh dengan foto bukti transfer.

- **Lihat mading dan saldo:** publik, tanpa login. Yang tampil hanya nama panggilan dan nominal.
- **Buat patungan, centang bayar, kelola anggota:** perlu **kode ruangan** (satu kode bersama, diingat perangkat).
- **Halaman** di GitHub Pages (`https://<username>.github.io/mading-maksi/`). **Data** di Cloudflare Workers + D1, tier gratis, karena GitHub Pages tidak bisa menyimpan data.
- **AI:** Gemini untuk membaca foto struk dan teks pesanan, Groq sebagai cadangan teks.

Spesifikasi lengkap (BRD, PRD, ERD) ada di dokumen Claude "Mading Maksi — BRD, PRD & ERD".

## Cara pakai

1. **Yang nalangin** menekan tombol **+ Patungan**, mengisi menu tiap orang (atau biar AI yang isi dari chat atau foto struk), lalu ongkir dan biaya lain. Bagian tiap orang langsung terhitung.
2. **Yang lain** transfer ke yang nalangin seperti biasa.
3. **Centang namamu** di mading, tandai sudah bayar, dan lampirkan bukti kalau mau. Patungan otomatis pindah ke "Sudah lunas" begitu semua mencentang.

## Publish (sekali saja)

### A. Server data di Cloudflare

1. Login: `npx wrangler login`
2. Buat database: `npx wrangler d1 create mading-maksi`, lalu salin `database_id` dari hasilnya ke `wrangler.jsonc`.
3. Buat tabel: `npm run db:migrate:remote`
4. Isi rahasia (diketik saat diminta, tidak tersimpan di kode):
   - `npx wrangler secret put KODE_RUANGAN`
   - `npx wrangler secret put GEMINI_API_KEY`, kunci gratis dari https://aistudio.google.com/apikey
   - `npx wrangler secret put GROQ_API_KEY` (opsional), kunci gratis dari https://console.groq.com/keys
5. Pastikan `ALLOWED_ORIGINS` di `wrangler.jsonc` berisi `https://<username-github>.github.io`.
6. Deploy: `npm run deploy`. Catat alamatnya, misalnya `https://mading-maksi.<subdomain>.workers.dev`.

### B. Halaman di GitHub Pages

1. Buat repo baru bernama `mading-maksi` di github.com, pilih **Public** (GitHub Pages gratis butuh repo publik; tidak ada rahasia di kode).
2. Hubungkan dan kirim kode:
   - `git remote add origin https://github.com/<username>/mading-maksi.git`
   - `git push -u origin main`
3. Di repo: **Settings → Pages → Source: GitHub Actions**.
4. Di repo: **Settings → Secrets and variables → Actions → Variables → New repository variable**, nama `API_BASE`, isi alamat Worker dari langkah A6.
5. Buka tab **Actions**, jalankan ulang **Publish ke GitHub Pages**. Setelah hijau, mading bisa dibuka di `https://<username>.github.io/mading-maksi/`.

Bagikan link itu ke grup ruangan, dan kode ruangan secara terpisah ke anggota saja.

## Jalankan di komputer sendiri

```bash
npm install
cp .dev.vars.example .dev.vars   # lalu isi KODE_RUANGAN, dan kunci AI kalau mau mencoba AI
npm run db:migrate:local
npm run dev                      # buka http://localhost:8787
```

Tes rumus hitung: `npm test`.

## Pengaturan

Di bagian `vars` pada `wrangler.jsonc`:

| Variabel | Bawaan | Arti |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://brandbabarafi.github.io` | Domain halaman yang boleh memanggil API. Pisahkan dengan koma kalau lebih dari satu. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model Gemini. Ganti kalau Google memensiunkannya. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model Groq cadangan untuk teks. |
| `PEMBULATAN` | `100` | Tagihan dibulatkan ke atas ke kelipatan ini (Rp). Selisihnya untuk penalang. |

Ganti kode ruangan kapan saja dengan `npx wrangler secret put KODE_RUANGAN`.

## Struktur

| Path | Isi |
| --- | --- |
| `public/` | Halaman web (tanpa framework, tanpa build). Folder ini yang dipublish ke GitHub Pages. |
| `public/hitung.js` | Rumus patungan; dipakai browser (pratinjau) dan server (sumber kebenaran) |
| `public/config.js` | Alamat API; ditulis ulang otomatis oleh workflow GitHub |
| `src/worker.js` | API: mading, saldo, patungan, anggota, centang bayar, bukti transfer, pembatas tebakan kode |
| `src/ai.js` | Panggilan Gemini dan Groq; AI hanya membaca menu dan biaya, tidak menghitung uang |
| `migrations/` | Skema database D1 |
| `.github/workflows/pages.yml` | Publish otomatis ke GitHub Pages setiap push ke `main` |

## Keamanan dan privasi

- Data publik hanya nama panggilan, nama resto, tanggal, nominal tagihan, dan status centang. Rincian menu dan bukti transfer hanya terlihat dengan kode ruangan.
- Bukti transfer sering memuat nama lengkap dan nomor rekening. Karena itu bukti hanya bisa dibuka dengan kode, dihapus saat centang dibatalkan, dan terhapus otomatis setelah 14 hari.
- Kode ruangan salah 10 kali dalam 15 menit dari satu IP akan diblokir sementara.
- Foto struk untuk AI hanya diteruskan ke Gemini lalu dibuang. Di tier gratis, Google boleh memakai data yang dikirim untuk pengembangan produknya.
- Halaman diberi `noindex` dan `robots.txt` supaya tidak muncul di mesin pencari.
