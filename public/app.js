import { hitung, BIAYA_BAWAAN } from './hitung.js';
import { DATA_REPO, PEMBULATAN } from './config.js';
import { ikon } from './ikon.js';
import { gudangGitHub, gudangLokal } from './gudang.js';
import { bukaKode, buatKode, kunciBaru, enkripsi, dekripsi, enkripsiJson, dekripsiJson, keB64, dariB64 } from './sandi.js';
import { bacaPesanan } from './ai.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

const rp = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const tanda = (n) => `${n < 0 ? '−' : '+'}${rp(Math.abs(n))}`;
const tgl = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
const hariIni = () => new Date().toLocaleDateString('en-CA');
const num = (v) => Math.max(0, Math.round(Number(v) || 0));

// el('button.btn.utama', { onclick }, 'Simpan'). Teks selalu masuk sebagai text node, jadi aman dari XSS.
function el(tag, attrs = {}, ...anak) {
  const [nama, ...kelas] = tag.split('.');
  const e = document.createElement(nama || 'div');
  if (kelas.length) e.className = kelas.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'class') e.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const a of anak.flat()) if (a != null && a !== false) e.append(a instanceof Node ? a : String(a));
  return e;
}

const simpan = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, String(v));
    } catch {}
  },
};

// ---------- Data di GitHub ----------

const DEMO = !DATA_REPO || new URLSearchParams(location.search).has('demo');

function bacaJsonAman(teks) {
  try {
    return JSON.parse(teks) ?? {};
  } catch {
    return {};
  }
}

// Salinan terakhir untuk baca bersyarat (ETag) oleh pengunjung tanpa kode.
const cachePublik = {
  ...bacaJsonAman(simpan.get('cache')),
  simpan(o) {
    Object.assign(this, o);
    simpan.set('cache', JSON.stringify({ etag: o.etag, sha: o.sha, data: o.data }));
  },
};

const gudang = DEMO
  ? gudangLokal({ getItem: (k) => simpan.get(k), setItem: (k, v) => simpan.set(k, v), removeItem: (k) => simpan.set(k, null) })
  : gudangGitHub({ repo: DATA_REPO, cache: cachePublik });

let kode = simpan.get('kode') ?? '';
let akses = null; // { token, kunci, gemini, groq } hasil membuka kode

async function aksesKode() {
  if (!kode) return null;
  akses ??= await bukaKode(kode);
  return akses;
}

function lupakanKode(pesan) {
  kode = '';
  akses = null;
  simpan.set('kode', null);
  renderKepala();
  if (pesan) toast(pesan);
}

let dataBasi = false;
async function muat() {
  let a = null;
  try {
    a = await aksesKode();
  } catch {
    lupakanKode('Kode ruangan di perangkat ini tidak valid lagi');
  }
  try {
    const h = await gudang.baca(a?.token);
    dataBasi = Boolean(h?.basi);
    return h?.data ?? null;
  } catch (e) {
    if (a && e.status === 401) {
      lupakanKode('Token di kode ruangan sudah tidak berlaku. Minta kode baru ke admin.');
      return muat();
    }
    throw e;
  }
}

async function ubahData(mutasi, pesan) {
  const a = await aksesKode();
  if (!a) throw new Error('Masukkan kode ruangan dulu');
  try {
    return (await gudang.tulis(a.token, mutasi, pesan)).hasil;
  } catch (e) {
    if (e.status === 401) lupakanKode('Token di kode ruangan sudah tidak berlaku. Minta kode baru ke admin.');
    throw e;
  }
}

async function verifikasiKode(teks) {
  let a;
  try {
    a = await bukaKode(teks);
  } catch {
    throw new Error('Kode ruangan tidak valid. Pastikan tersalin utuh.');
  }
  if (!(await gudang.cekAkses(a.token)).push) throw new Error('Token di kode ini tidak punya izin menulis data.');
  const h = await gudang.baca(a.token);
  if (!h) throw new Error('Data belum disiapkan. Admin perlu menjalankan Setup dulu.');
  try {
    await dekripsiJson(a.kunci, h.data.cek);
  } catch {
    throw new Error('Kode ini tidak cocok dengan data mading.');
  }
  return a;
}

const petaNama = (d) => new Map(d.anggota.map((a) => [a.id, a.nama]));
const urutTerbaru = (a, b) => b.tanggal.localeCompare(a.tanggal) || (b.dibuat_pada ?? '').localeCompare(a.dibuat_pada ?? '');
const jalurBukti = (pesertaId) => `bukti/${pesertaId}.bin`;
const UMUR_BUKTI_MS = 14 * 24 * 60 * 60 * 1000;

// Bentuk sesi untuk tampilan: nama orang sudah diisi.
function rapikanSesi(d, s) {
  const nm = petaNama(d);
  return {
    ...s,
    penalang: nm.get(s.penalang_id) ?? '?',
    peserta: s.peserta
      .map((p) => ({ ...p, nama: nm.get(p.anggota_id) ?? '?', total_tagihan: p.total, ada_bukti: Boolean(p.bukti_pada), penalang: p.anggota_id === s.penalang_id }))
      .sort((x, y) => x.nama.localeCompare(y.nama)),
  };
}

function perbaruiStatus(s) {
  if (s.status !== 'batal') s.status = s.peserta.every((p) => p.status_bayar === 'lunas') ? 'lunas' : 'terbuka';
}

function cariPeserta(d, sesiId, pesertaId) {
  const s = d.sesi.find((x) => x.id === sesiId);
  const p = s?.peserta.find((x) => x.id === pesertaId);
  if (!s || !p) throw new Error('Patungan ini sudah berubah. Muat ulang mading.');
  if (s.status === 'batal') throw new Error('Patungan ini sudah dibatalkan.');
  if (p.anggota_id === s.penalang_id) throw new Error('Porsi yang nalangin selalu lunas.');
  return { s, p };
}

// Lepas bukti yang lebih tua dari 14 hari; kembalikan file yang perlu dihapus.
function bersihkanBukti(d) {
  const batas = Date.now() - UMUR_BUKTI_MS;
  const buang = [];
  for (const s of d.sesi) {
    for (const p of s.peserta) {
      if (p.bukti_pada && Date.parse(p.bukti_pada) < batas) {
        p.bukti_pada = null;
        buang.push(jalurBukti(p.id));
      }
    }
  }
  return buang;
}

async function hapusFile(daftar) {
  const a = await aksesKode();
  for (const path of daftar) await gudang.hapusFile(a.token, path, 'Hapus bukti transfer').catch(() => {});
}

const WARNA = ['#d9480f', '#1971c2', '#2b8a3e', '#9c36b5', '#c2255c', '#0b7285', '#5f3dc4', '#495057'];
function avatar(nama, kecil = false) {
  let h = 0;
  for (const c of nama.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const e = el(kecil ? 'span.av.kecil' : 'span.av', { 'aria-hidden': 'true' }, nama.slice(0, 1).toUpperCase());
  e.style.setProperty('--av', WARNA[h % WARNA.length]);
  return e;
}

function toast(pesan) {
  const t = el('div.toast', { role: 'status' }, pesan);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

async function kecilkan(file, sisi, mutu) {
  const img = await createImageBitmap(file);
  const skala = Math.min(1, sisi / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * skala);
  c.height = Math.round(img.height * skala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', mutu).split(',')[1] };
}

// ---------- Panel bawah ----------

function bukaSheet(...isi) {
  $sheet.replaceChildren(el('button.ikon-btn.tutup-sheet', { type: 'button', 'aria-label': 'Tutup', onclick: tutupSheet }, ikon('silang')), ...isi);
  if (!$sheet.open) $sheet.showModal();
}
function tutupSheet() {
  if ($sheet.open) $sheet.close();
}
$sheet.addEventListener('click', (e) => {
  if (e.target !== $sheet) return;
  const r = $sheet.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) tutupSheet();
});

const kepalaSheet = (gambar, judul, sub) =>
  el('div.sheet-kepala', {}, gambar, el('div', {}, el('h2', {}, judul), sub ? el('p.sub', {}, sub) : null));

// ---------- Kode ruangan ----------

const PESAN_KODE = 'Kode dipakai untuk membuat patungan dan mencentang pembayaran. Minta ke admin ruangan. Cukup sekali, perangkat ini akan mengingatnya.';

function formKode(lanjut) {
  const input = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Tempel kode ruangan (MM1…)', 'aria-label': 'Kode ruangan' });
  const err = el('p.error', { role: 'alert' });
  const tombol = el('button.btn.utama', { type: 'submit' }, 'Buka');
  return el('form.tumpuk-kecil', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const nilai = input.value.trim();
      if (!nilai) {
        err.textContent = 'Tempel kode ruangan dulu';
        input.focus();
        return;
      }
      tombol.disabled = true;
      try {
        akses = await verifikasiKode(nilai);
        kode = nilai;
        simpan.set('kode', kode);
        renderKepala();
        toast('Kode tersimpan di perangkat ini');
        lanjut();
      } catch (x) {
        err.textContent = x.message;
        tombol.disabled = false;
      }
    },
  }, el('div.sejajar', {}, input, tombol), err);
}

function sheetKode(lanjut, pesan = PESAN_KODE) {
  bukaSheet(
    kepalaSheet(el('span.ikon-bulat', {}, ikon('kunci')), 'Masukkan kode ruangan', pesan),
    formKode(() => {
      tutupSheet();
      lanjut?.();
    }),
  );
  $sheet.querySelector('input')?.focus();
}

function sheetKodeAktif() {
  bukaSheet(
    kepalaSheet(el('span.ikon-bulat', {}, ikon('terbuka')), 'Kode ruangan aktif', 'Perangkat ini bisa membuat patungan, mencentang pembayaran, dan melihat bukti transfer.'),
    el('button.btn.penuh', {
      type: 'button',
      onclick: () => {
        lupakanKode('Perangkat ini kembali ke mode lihat');
        render();
      },
    }, ikon('kunci'), 'Kunci perangkat ini'),
  );
}

// ---------- Cara pakai ----------

const LANGKAH = [
  ['Yang nalangin bikin patungan', 'Tekan tombol + di bawah, isi menu tiap orang. Ongkir dan promo dibagi otomatis.'],
  ['Transfer ke yang nalangin', 'Lihat nominalmu di mading, lalu bayar lewat bank atau e-wallet seperti biasa.'],
  ['Centang namamu', 'Ketuk namamu di mading, tandai sudah bayar, dan lampirkan bukti kalau mau.'],
];
const daftarLangkah = () =>
  el('ol.langkah', {}, ...LANGKAH.map(([judul, isi], i) => el('li', {}, el('span.nomor', {}, String(i + 1)), el('div', {}, el('b', {}, judul), el('p.sub', {}, isi)))));

function kartuPanduan() {
  const k = el('section.kartu.panduan.tumpuk-kecil', {},
    el('h2', {}, 'Cara pakai Mading Maksi'),
    daftarLangkah(),
    el('button.btn.kecil', {
      type: 'button',
      onclick: () => {
        simpan.set('panduan_ok', 1);
        k.remove();
      },
    }, 'Oke, paham'));
  return k;
}

function sheetBantuan() {
  bukaSheet(
    kepalaSheet(el('span.ikon-bulat', {}, ikon('bantuan')), 'Cara pakai', 'Patungan maksi tanpa ribet hitung manual.'),
    daftarLangkah(),
    el('h3', {}, 'Kode ruangan'),
    el('p.sub', {}, 'Siapa pun yang punya link bisa melihat mading. Untuk membuat patungan atau mencentang pembayaran, perlu kode ruangan dari admin.'),
    el('h3', {}, 'Privasi'),
    el('p.sub', {}, 'Data disimpan di repo GitHub publik. Yang terbaca publik cuma nama panggilan, nama resto, dan nominal. Rincian menu dan bukti transfer dienkripsi, hanya bisa dibuka dengan kode, dan bukti terhapus otomatis setelah 14 hari.'),
    el('h3', {}, 'Untuk admin'),
    el('p.sub', {}, 'Menyiapkan mading pertama kali atau memperbarui kode ruangan: ', el('a', { href: '#/setup', onclick: tutupSheet }, 'buka Setup'), '.'),
    el('div.sheet-aksi', {}, el('span'), el('button.btn.utama', { type: 'button', onclick: tutupSheet }, 'Mengerti')),
  );
}

// ---------- Kerangka dan rute ----------

function renderKepala() {
  const hash = location.hash || '#/';
  for (const a of document.querySelectorAll('#nav a')) {
    const href = a.getAttribute('href');
    if (href === hash || (href === '#/' && hash.startsWith('#/sesi/'))) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const chip = document.getElementById('chip-kode');
  chip.className = kode ? 'chip-kode aktif' : 'chip-kode';
  chip.replaceChildren(ikon(kode ? 'terbuka' : 'mata'), kode ? 'Kode aktif' : 'Mode lihat');
}

function perluKode(view, judul) {
  return (arg) =>
    kode
      ? view(arg)
      : el('section.kartu.tumpuk-kecil', {}, kepalaSheet(el('span.ikon-bulat', {}, ikon('kunci')), `${judul} perlu kode ruangan`, PESAN_KODE), formKode(render));
}

const rute = [
  [/^#\/?$/, viewMading],
  [/^#\/saldo$/, viewSaldo],
  [/^#\/baru$/, perluKode(viewBaru, 'Buat patungan')],
  [/^#\/anggota$/, perluKode(viewAnggota, 'Kelola anggota')],
  [/^#\/sesi\/([\w-]+)$/, perluKode(viewSesi, 'Detail patungan')],
  [/^#\/setup$/, viewSetup],
];

const bannerDemo = () => el('p.peringatan', {}, 'Mode demo: data hanya tersimpan di browser ini, tidak di GitHub.');

let giliran = 0;
async function render() {
  renderKepala();
  tutupSheet();
  const hash = location.hash || '#/';
  let view = viewMading;
  let arg;
  for (const [pola, v] of rute) {
    const m = hash.match(pola);
    if (m) {
      [view, arg] = [v, m[1]];
      break;
    }
  }
  const ini = ++giliran;
  try {
    const isi = await view(arg);
    if (ini === giliran) $app.replaceChildren(...(DEMO ? [bannerDemo()] : []), isi);
  } catch (e) {
    if (ini === giliran) {
      $app.replaceChildren(el('section.kartu.tumpuk-kecil', {}, el('p.error', {}, e.message), el('button.btn.kecil', { type: 'button', onclick: render }, 'Coba lagi')));
    }
  }
}

document.getElementById('logo').append(ikon('mangkok'));
document.getElementById('tombol-bantuan').append(ikon('bantuan'));
for (const a of document.querySelectorAll('#nav a')) a.prepend(ikon(a.dataset.ikon));
document.getElementById('tombol-bantuan').addEventListener('click', sheetBantuan);
document.getElementById('chip-kode').addEventListener('click', () => (kode ? sheetKodeAktif() : sheetKode(render)));
window.addEventListener('hashchange', render);
// Balik ke tab atau aplikasi: muat ulang mading/saldo supaya centang terbaru kelihatan.
document.addEventListener('visibilitychange', () => {
  const hash = location.hash || '#/';
  if (document.visibilityState === 'visible' && !$sheet.open && /^#\/?$|^#\/saldo$/.test(hash)) render();
});
render();

function kartuBelumSiap() {
  return el('section.kartu.kosong', {},
    el('div.ikon-besar', {}, ikon('mangkok')),
    el('h2', {}, 'Mading belum disiapkan'),
    el('p.sub', {}, 'Admin ruangan perlu menjalankan Setup sekali untuk menyiapkan tempat data di GitHub.'),
    el('a.btn.utama', { href: '#/setup' }, 'Buka Setup'));
}

// ---------- Mading ----------

async function viewMading() {
  const d = await muat();
  if (!d) return kartuBelumSiap();
  const sesi = d.sesi.filter((s) => s.status !== 'batal').sort(urutTerbaru).map((s) => rapikanSesi(d, s));
  const tagihan = sesi.filter((s) => s.status === 'terbuka').flatMap((s) => s.peserta.filter((p) => !p.penalang && p.status_bayar === 'belum'));
  const belum = { jumlah: tagihan.reduce((a, p) => a + p.total, 0), tagihan: tagihan.length };
  const isi = el('div.tumpuk');
  if (dataBasi) isi.append(el('p.catatan', {}, 'Data mungkin tertinggal beberapa menit karena GitHub sedang membatasi akses. Masukkan kode ruangan untuk melihat yang terbaru.'));
  if (!simpan.get('panduan_ok')) isi.append(kartuPanduan());
  isi.append(el('section.ringkas', {},
    el('div', {},
      el('p.label', {}, 'Belum dibayar'),
      el('p.angka', {}, rp(belum.jumlah)),
      el('p.sub', {}, belum.tagihan ? `${belum.tagihan} tagihan menunggu` : 'Semua tagihan sudah beres')),
    el('a.btn.kecil', { href: '#/saldo' }, 'Saldo saya', ikon('kanan'))));

  if (!sesi.length) {
    isi.append(el('section.kartu.kosong', {},
      el('div.ikon-besar', {}, ikon('mangkok')),
      el('h2', {}, 'Belum ada patungan'),
      el('p.sub', {}, 'Yang nalangin maksi hari ini bisa mulai dari sini. Bagian tiap orang langsung terhitung.'),
      el('a.btn.utama', { href: '#/baru' }, ikon('tambah'), 'Buat patungan')));
    return isi;
  }
  const terbuka = sesi.filter((s) => s.status !== 'lunas');
  const lunas = sesi.filter((s) => s.status === 'lunas').slice(0, 15);
  if (terbuka.length) isi.append(el('h2.judul-bagian', {}, 'Belum lunas'), ...terbuka.map(kartuSesi));
  if (lunas.length) isi.append(el('h2.judul-bagian', {}, 'Sudah lunas'), ...lunas.map(kartuLunas));
  return isi;
}

function kartuSesi(s) {
  const utang = s.peserta.filter((p) => !p.penalang);
  const sudah = utang.filter((p) => p.status_bayar === 'lunas').length;
  const bar = el('div.bar', { role: 'progressbar', 'aria-label': 'Sudah bayar', 'aria-valuemin': 0, 'aria-valuemax': utang.length, 'aria-valuenow': sudah }, el('span'));
  bar.firstChild.style.setProperty('width', `${utang.length ? (sudah / utang.length) * 100 : 100}%`);
  return el('article.kartu', {},
    el('header.kartu-kepala', {},
      el('div', {}, el('h3', {}, s.resto), el('p.sub', {}, tgl(s.tanggal))),
      kode ? el('a.ikon-btn', { href: `#/sesi/${s.id}`, 'aria-label': `Detail ${s.resto}` }, ikon('kanan')) : null),
    el('div.penalang', {}, avatar(s.penalang, true), el('span', {}, 'Transfer ke ', el('b', {}, s.penalang), ' yang nalangin')),
    el('div.progres', {}, bar, el('span.sub', {}, `${sudah} dari ${utang.length} orang sudah bayar`)),
    el('ul.ceklis', {}, ...utang.map((p) => el('li', {}, barisCeklis(p, s, true)))));
}

function kartuLunas(s) {
  const judul = kode ? el('a', { href: `#/sesi/${s.id}` }, s.resto) : s.resto;
  return el('article.kartu.lunas', {},
    el('header.kartu-kepala', {},
      el('div', {}, el('h3', {}, judul), el('p.sub', {}, `${tgl(s.tanggal)} · ditalangin ${s.penalang}`)),
      el('span.badge.ok', {}, ikon('cek'), 'Lunas')),
    el('div.avatar-baris', {}, ...s.peserta.filter((p) => !p.penalang).map((p) => avatar(p.nama, true))));
}

function barisCeklis(p, s, bisaUbah) {
  const sudah = p.status_bayar === 'lunas';
  const isi = [
    el('span.kotak', { 'aria-hidden': 'true' }, sudah ? ikon('cek') : null),
    avatar(p.nama, true),
    el('span.nama', {}, p.nama),
    p.ada_bukti ? el('span.bukti-tag', { title: 'Ada bukti transfer' }, ikon('gambar')) : null,
    el('span.nominal', {}, rp(p.total_tagihan)),
  ];
  const label = `${p.nama}, ${rp(p.total_tagihan)}, ${sudah ? 'sudah bayar' : 'belum bayar'}`;
  if (!bisaUbah) return el(sudah ? 'div.ceklis-baris.sudah' : 'div.ceklis-baris', { 'aria-label': label }, isi);
  return el(sudah ? 'button.ceklis-baris.sudah' : 'button.ceklis-baris', { type: 'button', 'aria-label': label, onclick: () => sheetBayar(p, s) }, isi);
}

function sheetBayar(p, s) {
  if (!kode) return sheetKode(() => sheetBayar(p, s), `Masukkan kode ruangan dulu supaya bisa mencentang tagihan ${p.nama}.`);
  if (p.status_bayar === 'lunas') return sheetSudahBayar(p, s);

  let bukti = null;
  const err = el('p.error', { role: 'alert' });
  const pratinjau = el('div.pratinjau');
  const input = el('input.sembunyi', {
    type: 'file',
    accept: 'image/*',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      err.textContent = '';
      try {
        bukti = await kecilkan(f, 1280, 0.75);
        pratinjau.replaceChildren(
          el('img', { src: `data:${bukti.mime};base64,${bukti.data}`, alt: 'Pratinjau bukti transfer' }),
          el('button.btn.kecil', {
            type: 'button',
            onclick: () => {
              bukti = null;
              input.value = '';
              pratinjau.replaceChildren(pilih);
            },
          }, ikon('sampah'), 'Hapus foto'));
      } catch {
        err.textContent = 'Foto tidak bisa dibaca. Coba foto lain.';
      }
    },
  });
  const pilih = el('label.dropzone', {}, ikon('kamera'), el('span', {}, el('b', {}, 'Lampirkan bukti transfer'), el('br'), el('span.sub', {}, 'Opsional · foto atau screenshot')), input);
  pratinjau.append(pilih);

  const kirim = el('button.btn.utama', {
    type: 'button',
    onclick: async () => {
      kirim.disabled = true;
      err.textContent = '';
      try {
        const a = await aksesKode();
        if (bukti) {
          kirim.lastChild.textContent = 'Mengunggah bukti…';
          const sandi = await enkripsi(a.kunci, dariB64(bukti.data));
          await gudang.simpanFile(a.token, jalurBukti(p.id), keB64(sandi), `Bukti bayar ${p.nama} · ${s.resto}`);
        }
        kirim.lastChild.textContent = 'Menyimpan…';
        const buang = await ubahData((d) => {
          const { s: x, p: q } = cariPeserta(d, s.id, p.id);
          const kini = new Date().toISOString();
          q.status_bayar = 'lunas';
          q.lunas_pada = kini;
          if (bukti) q.bukti_pada = kini;
          perbaruiStatus(x);
          return bersihkanBukti(d);
        }, `${p.nama} sudah bayar · ${s.resto}`);
        await hapusFile(buang);
        toast(`${p.nama} sudah bayar`);
        render();
      } catch (x) {
        err.textContent = x.message;
        kirim.lastChild.textContent = 'Sudah bayar';
        kirim.disabled = false;
      }
    },
  }, ikon('cek'), el('span', {}, 'Sudah bayar'));

  bukaSheet(
    kepalaSheet(avatar(p.nama), `${p.nama} sudah bayar?`, `${rp(p.total_tagihan)} ke ${s.penalang} · ${s.resto}`),
    pratinjau,
    el('p.catatan', {}, 'Bukti cuma bisa dilihat yang punya kode ruangan, dan terhapus otomatis setelah 14 hari.'),
    err,
    el('div.sheet-aksi', {}, el('button.btn', { type: 'button', onclick: tutupSheet }, 'Batal'), kirim),
  );
}

async function sheetSudahBayar(p, s) {
  const tempat = el('div.pratinjau', {}, el('p.sub', {}, p.ada_bukti ? 'Memuat bukti…' : 'Tidak ada bukti yang dilampirkan.'));
  const err = el('p.error', { role: 'alert' });
  const batal = el('button.btn.bahaya', {
    type: 'button',
    onclick: async () => {
      if (!confirm(`Tandai ${p.nama} belum bayar? Bukti transfernya ikut terhapus.`)) return;
      batal.disabled = true;
      try {
        const buang = await ubahData((d) => {
          const { s: x, p: q } = cariPeserta(d, s.id, p.id);
          const lama = q.bukti_pada ? [jalurBukti(q.id)] : [];
          q.status_bayar = 'belum';
          q.lunas_pada = null;
          q.bukti_pada = null;
          perbaruiStatus(x);
          return [...lama, ...bersihkanBukti(d)];
        }, `${p.nama} ditandai belum bayar · ${s.resto}`);
        await hapusFile(buang);
        toast(`${p.nama} ditandai belum bayar`);
        render();
      } catch (x) {
        err.textContent = x.message;
        batal.disabled = false;
      }
    },
  }, 'Tandai belum bayar');
  bukaSheet(
    kepalaSheet(avatar(p.nama), `${p.nama} sudah bayar`, `${rp(p.total_tagihan)} ke ${s.penalang} · ${s.resto}`),
    tempat,
    err,
    el('div.sheet-aksi', {}, batal, el('button.btn.utama', { type: 'button', onclick: tutupSheet }, 'Tutup')),
  );
  if (!p.ada_bukti) return;
  try {
    const a = await aksesKode();
    const sandi = await gudang.ambilFile(a.token, jalurBukti(p.id));
    if (!sandi) throw new Error('Bukti sudah terhapus.');
    let foto;
    try {
      foto = await dekripsi(a.kunci, sandi);
    } catch {
      throw new Error('Bukti tidak bisa dibuka dengan kode ini.');
    }
    tempat.replaceChildren(el('img', { src: URL.createObjectURL(new Blob([foto], { type: 'image/jpeg' })), alt: `Bukti transfer ${p.nama}` }));
  } catch (x) {
    tempat.replaceChildren(el('p.error', {}, x.message));
  }
}

// ---------- Saldo ----------

async function viewSaldo() {
  const d = await muat();
  if (!d) return kartuBelumSiap();
  const nm = petaNama(d);
  const anggota = [...d.anggota].sort((a, b) => a.nama.localeCompare(b.nama));
  const peta = new Map();
  for (const s of d.sesi) {
    if (s.status !== 'terbuka') continue;
    for (const p of s.peserta) {
      if (p.status_bayar !== 'belum' || p.anggota_id === s.penalang_id) continue;
      const k = `${p.anggota_id}>${s.penalang_id}`;
      peta.set(k, (peta.get(k) ?? 0) + p.total);
    }
  }
  const utang = [...peta].map(([k, jumlah]) => {
    const [dari, ke] = k.split('>');
    return { dari: nm.get(dari), ke: nm.get(ke), jumlah };
  });

  let saya = simpan.get('saya') ?? '';
  const chips = el('div.chips', { role: 'radiogroup', 'aria-label': 'Kamu siapa?' });
  const hasil = el('div.tumpuk');

  function gambarChips() {
    chips.replaceChildren(...anggota
      .filter((a) => a.aktif || a.nama === saya)
      .map((a) => el('button.chip', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(a.nama === saya),
        onclick: () => {
          saya = a.nama;
          simpan.set('saya', saya);
          gambarChips();
          tampil();
        },
      }, avatar(a.nama, true), a.nama)));
  }

  function tampil() {
    hasil.replaceChildren();
    if (!saya) return;
    const net = new Map();
    for (const u of utang) {
      if (u.dari === saya && u.ke !== saya) net.set(u.ke, (net.get(u.ke) ?? 0) - u.jumlah);
      if (u.ke === saya && u.dari !== saya) net.set(u.dari, (net.get(u.dari) ?? 0) + u.jumlah);
    }
    const baris = [...net].filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const bayar = -baris.filter(([, v]) => v < 0).reduce((a, [, v]) => a + v, 0);
    const terima = baris.filter(([, v]) => v > 0).reduce((a, [, v]) => a + v, 0);

    if (!baris.length) {
      hasil.append(el('section.saldo-besar.netral', {}, el('p.angka', {}, 'Semua beres'), el('p.sub', {}, `${saya} tidak punya utang atau piutang yang belum lunas.`)));
      return;
    }
    if (bayar) hasil.append(el('section.saldo-besar.awas', {}, el('p', {}, 'Kamu perlu bayar'), el('p.angka', {}, rp(bayar))));
    if (terima) hasil.append(el('section.saldo-besar.ok', {}, el('p', {}, 'Kamu akan menerima'), el('p.angka', {}, rp(terima))));
    hasil.append(el('section.kartu', {},
      ...baris.map(([n, v]) => el('div.baris', {},
        avatar(n),
        el('div.isi', {}, el('b', {}, v < 0 ? `Bayar ke ${n}` : `${n} bayar ke kamu`)),
        el('span.nominal', { class: v > 0 ? 'hijau' : null }, rp(Math.abs(v))))),
      el('p.catatan', {}, 'Kalau saling utang, yang tampil cuma selisihnya. Centang tetap per patungan di mading.')));
  }

  gambarChips();
  tampil();
  return el('div.tumpuk', {},
    el('section.kartu.tumpuk-kecil', {}, el('h2', {}, 'Kamu siapa?'), el('p.sub', {}, 'Pilih namamu untuk melihat utang dan piutangmu.'), chips),
    hasil);
}

// ---------- Detail patungan ----------

async function viewSesi(id) {
  const d = await muat();
  if (!d) return kartuBelumSiap();
  const mentah = d.sesi.find((x) => x.id === id);
  if (!mentah) throw new Error('Patungan tidak ditemukan.');
  const nm = petaNama(d);
  const a = await aksesKode();
  let rahasia;
  try {
    rahasia = await dekripsiJson(a.kunci, mentah.rahasia);
  } catch {
    throw new Error('Rincian patungan ini tidak bisa dibuka dengan kode di perangkat ini.');
  }
  const s = {
    ...rapikanSesi(d, mentah),
    biaya: rahasia.biaya,
    items: rahasia.items.map((it) => ({ ...it, pemakan: Object.keys(it.porsi).map((idAnggota) => ({ nama: nm.get(idAnggota) ?? '?' })) })),
  };
  const batal = s.status === 'batal';
  const utang = s.peserta.filter((p) => !p.penalang);
  return el('div.tumpuk', {},
    el('a.kembali', { href: '#/' }, ikon('kiri'), 'Mading'),
    el('section.kartu', {},
      el('div.kartu-kepala', {},
        el('div', {}, el('h2', {}, s.resto), el('p.sub', {}, tgl(s.tanggal))),
        batal ? el('span.badge.awas', {}, 'Dibatalkan') : s.status === 'lunas' ? el('span.badge.ok', {}, ikon('cek'), 'Lunas') : null),
      el('div.penalang', {}, avatar(s.penalang, true), el('span', {}, 'Ditalangin ', el('b', {}, s.penalang)))),
    el('section.kartu', {},
      el('h3', {}, 'Checklist bayar'),
      utang.length ? el('ul.ceklis', {}, ...utang.map((p) => el('li', {}, barisCeklis(p, s, !batal)))) : el('p.sub', {}, 'Tidak ada yang perlu bayar.')),
    el('section.kartu', {},
      el('h3', {}, 'Pesanan'),
      ...s.items.map((it) => el('div.baris', {},
        el('div.isi', {},
          el('b', {}, `${it.nama_item}${it.qty > 1 ? ` ×${it.qty}` : ''}`),
          el('div.avatar-baris', {}, ...it.pemakan.map((p) => avatar(p.nama, true)))),
        el('span.nominal', {}, rp(it.harga_satuan * it.qty))))),
    s.biaya.length
      ? el('section.kartu', {},
          el('h3', {}, 'Ongkir dan biaya'),
          ...s.biaya.map((b) => el('div.baris', {},
            el('div.isi', {}, el('b', {}, b.nama_biaya), el('p.sub', {}, b.cara_bagi === 'rata' ? 'dibagi rata' : 'sesuai pesanan')),
            el('span.nominal', { class: b.potongan ? 'hijau' : null }, `${b.potongan ? '−' : ''}${rp(b.nominal)}`))))
      : null,
    batal
      ? null
      : el('button.btn.bahaya', {
          type: 'button',
          onclick: async () => {
            if (!confirm('Batalkan patungan ini? Tagihannya hilang dari mading, riwayatnya tetap tersimpan.')) return;
            try {
              await ubahData((data) => {
                const x = data.sesi.find((y) => y.id === id);
                if (!x) throw new Error('Patungan tidak ditemukan.');
                x.status = 'batal';
              }, `Batalkan patungan ${s.resto}`);
              toast('Patungan dibatalkan');
              location.hash = '#/';
            } catch (x) {
              alert(x.message);
            }
          },
        }, 'Batalkan patungan ini'));
}

// ---------- Anggota ----------

async function viewAnggota() {
  const d = await muat();
  if (!d) return kartuBelumSiap();
  const anggota = [...d.anggota].sort((a, b) => a.nama.localeCompare(b.nama));
  const input = el('input', { placeholder: 'Nama panggilan, misal Sari', maxlength: 30, 'aria-label': 'Nama panggilan' });
  const err = el('p.error', { role: 'alert' });
  return el('div.tumpuk', {},
    el('section.kartu.tumpuk-kecil', {},
      el('h2', {}, 'Anggota ruangan'),
      el('p.sub', {}, 'Pakai nama panggilan saja, karena nama ini tampil publik di mading.'),
      el('form.sejajar', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          const nama = input.value.trim();
          if (!nama) return void (err.textContent = 'Isi nama panggilan dulu');
          try {
            await ubahData((data) => {
              if (data.anggota.some((x) => x.nama.toLowerCase() === nama.toLowerCase())) throw new Error(`"${nama}" sudah ada`);
              data.anggota.push({ id: crypto.randomUUID().slice(0, 8), nama, aktif: true });
            }, `Tambah anggota ${nama}`);
            toast(`${nama} ditambahkan`);
            render();
          } catch (x) {
            err.textContent = x.message;
          }
        },
      }, input, el('button.btn.utama', { type: 'submit' }, ikon('tambah'), 'Tambah')),
      err),
    el('section.kartu', {},
      anggota.length
        ? anggota.map((a) => el('div.baris', { class: a.aktif ? null : 'redup' },
            avatar(a.nama),
            el('div.isi', {}, el('b', {}, a.nama), a.aktif ? null : el('p.sub', {}, 'Nonaktif, tidak muncul di pilihan')),
            el('button.btn.kecil', {
              type: 'button',
              onclick: async () => {
                try {
                  await ubahData((data) => {
                    const x = data.anggota.find((y) => y.id === a.id);
                    if (x) x.aktif = !a.aktif;
                  }, `${a.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${a.nama}`);
                  render();
                } catch (x) {
                  alert(x.message);
                }
              },
            }, a.aktif ? 'Nonaktifkan' : 'Aktifkan')))
        : el('p.sub', {}, 'Belum ada anggota. Tambahkan nama panggilan semua orang di ruangan.')));
}

// ---------- Buat patungan (3 langkah) ----------

const itemBaru = (x = {}) => ({ nama_item: '', harga_satuan: 0, qty: 1, sumber: 'manual', porsi: new Set(), ...x });
const biayaAwal = () => BIAYA_BAWAAN.map((b) => ({ ...b, nominal: 0, bawaan: true }));
const BIAYA_UTAMA = new Set(['Ongkir', 'Biaya layanan', 'Promo makanan']);
const NAMA_LANGKAH = ['Pesanan', 'Biaya', 'Cek'];

async function viewBaru() {
  const d = await muat();
  if (!d) return kartuBelumSiap();
  const pembulatan = PEMBULATAN;
  const aktif = d.anggota.filter((a) => a.aktif).sort((a, b) => a.nama.localeCompare(b.nama));
  if (!aktif.length) {
    return el('section.kartu.kosong', {},
      el('div.ikon-besar', {}, ikon('orang')),
      el('h2', {}, 'Tambahkan anggota dulu'),
      el('p.sub', {}, 'Patungan butuh daftar nama panggilan orang di ruangan.'),
      el('a.btn.utama', { href: '#/anggota' }, ikon('tambah'), 'Tambah anggota'));
  }

  const tersimpan = simpan.get('penalang');
  const st = {
    resto: '',
    tanggal: hariIni(),
    penalang_id: aktif.some((a) => a.id === tersimpan) ? tersimpan : aktif[0].id,
    items: [itemBaru()],
    biaya: biayaAwal(),
    semuaBiaya: false,
    total_struk: null,
    teksAI: '',
  };
  let langkah = 1;

  const namaDari = (id) => aktif.find((a) => a.id === id)?.nama ?? '?';
  const itemsSiap = () =>
    st.items
      .filter((it) => it.nama_item.trim() || it.harga_satuan)
      .map((it) => ({ ...it, porsi: Object.fromEntries([...it.porsi].map((id) => [id, 1])) }));
  const hitungAman = () => {
    try {
      return { ok: true, ...hitung({ items: itemsSiap(), biaya: st.biaya, pembulatan }) };
    } catch (e) {
      return { ok: false, pesan: e.message };
    }
  };

  const wadah = el('div.tumpuk');
  const errLangkah = el('p.error', { role: 'alert' });
  const footerIsi = el('div.footer-isi');
  const footer = el('div.footer-aksi', {}, errLangkah, footerIsi);
  const tombolPasang = el('button.btn.utama', { type: 'button', onclick: pasang }, ikon('cek'), 'Pasang');

  function gambar() {
    const isi = langkah === 1 ? langkahPesanan() : langkah === 2 ? langkahBiaya() : langkahCek();
    wadah.replaceChildren(stepper(), ...isi);
    errLangkah.textContent = '';
    gambarFooter();
    window.scrollTo({ top: 0 });
  }

  function stepper() {
    return el('ol.stepper', { 'aria-label': 'Langkah' }, ...NAMA_LANGKAH.map((n, i) => {
      const ke = i + 1;
      return el('li', { class: ke < langkah ? 'selesai' : ke === langkah ? 'aktif' : null, 'aria-current': ke === langkah ? 'step' : null },
        el('span.nomor', {}, ke < langkah ? ikon('cek') : String(ke)), el('span', {}, n));
    }));
  }

  function gambarFooter() {
    const h = hitungAman();
    footerIsi.replaceChildren(
      el('div.footer-info', {},
        h.ok
          ? [el('span.sub', {}, 'Total ke resto'), el('b', {}, rp(h.total_bayar))]
          : [el('span.sub', {}, `Langkah ${langkah} dari 3`), el('b', {}, NAMA_LANGKAH[langkah - 1])]),
      el('div.sejajar', {},
        langkah > 1 ? el('button.btn', { type: 'button', onclick: () => { langkah -= 1; gambar(); } }, 'Kembali') : null,
        langkah < 3 ? el('button.btn.utama', { type: 'button', onclick: lanjut }, 'Lanjut', ikon('kanan')) : tombolPasang));
  }

  function lanjut() {
    errLangkah.textContent = '';
    const salah = (pesan) => void (errLangkah.textContent = pesan);
    if (langkah === 1) {
      if (!st.resto.trim()) return salah('Isi dulu pesan dari mana');
      const items = itemsSiap();
      if (!items.length) return salah('Tambahkan minimal satu menu');
      const tanpaNama = items.find((it) => !it.nama_item.trim());
      if (tanpaNama) return salah('Ada menu yang belum diberi nama');
      const tanpaHarga = items.find((it) => !it.harga_satuan);
      if (tanpaHarga) return salah(`Isi harga "${tanpaHarga.nama_item}"`);
    }
    if (langkah === 2 && st.biaya.some((b) => b.nominal > 0 && !b.nama_biaya.trim())) return salah('Beri nama untuk biaya lain');
    const h = hitungAman();
    if (!h.ok) return salah(h.pesan);
    langkah += 1;
    gambar();
  }

  async function pasang() {
    errLangkah.textContent = '';
    tombolPasang.disabled = true;
    try {
      const items = itemsSiap().map(({ nama_item, harga_satuan, qty, sumber, porsi }) => ({ nama_item, harga_satuan, qty, sumber, porsi }));
      const biaya = st.biaya.filter((b) => b.nominal > 0).map(({ nama_biaya, nominal, cara_bagi, potongan }) => ({ nama_biaya, nominal, cara_bagi, potongan }));
      const h = hitung({ items, biaya, pembulatan });
      const kini = new Date().toISOString();
      const sesi = {
        id: crypto.randomUUID(),
        resto: st.resto.trim(),
        tanggal: st.tanggal,
        penalang_id: st.penalang_id,
        status: 'terbuka',
        dibuat_pada: kini,
        peserta: h.peserta.map((p) => {
          const nalangin = p.anggota_id === st.penalang_id;
          return { id: crypto.randomUUID(), anggota_id: p.anggota_id, total: p.total, status_bayar: nalangin ? 'lunas' : 'belum', lunas_pada: nalangin ? kini : null, bukti_pada: null };
        }),
        // Rincian menu dan biaya hanya bisa dibaca pemegang kode.
        rahasia: await enkripsiJson((await aksesKode()).kunci, { items, biaya }),
      };
      perbaruiStatus(sesi);
      await ubahData((data) => {
        const aktifSekarang = new Set(data.anggota.filter((x) => x.aktif).map((x) => x.id));
        if (![sesi.penalang_id, ...sesi.peserta.map((p) => p.anggota_id)].every((x) => aktifSekarang.has(x))) {
          throw new Error('Ada anggota yang baru saja dinonaktifkan. Muat ulang lalu coba lagi.');
        }
        data.sesi.push(sesi);
      }, `Patungan ${sesi.resto} (${sesi.tanggal})`);
      simpan.set('penalang', st.penalang_id);
      toast('Patungan dipasang di mading');
      location.hash = '#/';
    } catch (x) {
      errLangkah.textContent = x.message;
      tombolPasang.disabled = false;
    }
  }

  function chipsPenalang() {
    const wrap = el('div.chips', { role: 'radiogroup', 'aria-label': 'Siapa yang nalangin' });
    const gambarChip = () =>
      wrap.replaceChildren(...aktif.map((a) => el('button.chip', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(a.id === st.penalang_id),
        onclick: () => {
          st.penalang_id = a.id;
          gambarChip();
        },
      }, avatar(a.nama, true), a.nama)));
    gambarChip();
    return wrap;
  }

  // Langkah 1: pesanan
  function langkahPesanan() {
    const daftar = el('div.tumpuk-kecil');
    const gambarItems = () => daftar.replaceChildren(...st.items.map(kartuItem));

    function kartuItem(it, i) {
      const qty = el('span.qty-angka', {}, String(it.qty));
      const ubahQty = (d) => {
        it.qty = Math.max(1, it.qty + d);
        qty.textContent = it.qty;
        gambarFooter();
      };
      const semua = aktif.every((a) => it.porsi.has(a.id));
      return el('div.item', {},
        el('div.item-baris', {},
          el('input', { value: it.nama_item, placeholder: 'Nama menu, misal nasi ayam', maxlength: 80, 'aria-label': 'Nama menu', oninput: (e) => { it.nama_item = e.target.value; gambarFooter(); } }),
          el('button.ikon-btn', {
            type: 'button',
            'aria-label': 'Hapus menu',
            onclick: () => {
              st.items.splice(i, 1);
              if (!st.items.length) st.items.push(itemBaru());
              gambarItems();
              gambarFooter();
            },
          }, ikon('sampah'))),
        el('div.item-baris', {},
          el('label.uang', {}, el('span', {}, 'Rp'),
            el('input', { type: 'number', inputmode: 'numeric', min: 0, step: 500, value: it.harga_satuan || '', placeholder: 'Harga satuan', 'aria-label': 'Harga satuan', oninput: (e) => { it.harga_satuan = num(e.target.value); gambarFooter(); } })),
          el('div.qty', { role: 'group', 'aria-label': 'Jumlah porsi' },
            el('button', { type: 'button', 'aria-label': 'Kurangi porsi', onclick: () => ubahQty(-1) }, ikon('kurang')),
            qty,
            el('button', { type: 'button', 'aria-label': 'Tambah porsi', onclick: () => ubahQty(1) }, ikon('tambah')))),
        el('div.chips', {},
          el('span.sub', {}, 'Dimakan'),
          ...aktif.map((a) => el('button.chip', {
            type: 'button',
            'aria-pressed': String(it.porsi.has(a.id)),
            onclick: (e) => {
              if (it.porsi.has(a.id)) it.porsi.delete(a.id);
              else it.porsi.add(a.id);
              e.currentTarget.setAttribute('aria-pressed', String(it.porsi.has(a.id)));
              gambarFooter();
            },
          }, avatar(a.nama, true), a.nama)),
          aktif.length > 1
            ? el('button.chip.teks', {
                type: 'button',
                'aria-pressed': String(semua),
                onclick: () => {
                  it.porsi = semua ? new Set() : new Set(aktif.map((a) => a.id));
                  gambarItems();
                  gambarFooter();
                },
              }, 'Semua')
            : null),
        it.sumber === 'ai' ? el('span.tag-ai', {}, ikon('kilau'), 'Diisi AI, cek lagi') : null);
    }

    const teks = el('textarea', {
      rows: 3,
      maxlength: 4000,
      value: st.teksAI,
      'aria-label': 'Teks pesanan',
      placeholder: 'aku nasi ayam 25rb, sari mie goreng 20, dodi nasi ayam + es teh 30, ongkir 9rb, promo 15rb',
      oninput: (e) => { st.teksAI = e.target.value; },
    });
    let foto = null;
    const namaFoto = el('span.nama-file');
    const inputFoto = el('input.sembunyi', {
      type: 'file',
      accept: 'image/*',
      onchange: (e) => {
        foto = e.target.files[0] ?? null;
        namaFoto.textContent = foto ? foto.name : '';
      },
    });
    const status = el('p.sub', { role: 'status' });
    const tombolAI = el('button.btn.utama.kecil', { type: 'button', onclick: bacaAI }, ikon('kilau'), 'Isi otomatis');

    async function bacaAI() {
      if (!st.teksAI.trim() && !foto) {
        status.className = 'error';
        status.textContent = 'Tempel teks pesanan atau pilih foto struk dulu';
        return;
      }
      status.className = 'sub';
      status.textContent = 'AI sedang membaca…';
      tombolAI.disabled = true;
      try {
        const gambarStruk = foto ? await kecilkan(foto, 1600, 0.85) : null;
        const a = await aksesKode();
        const r = await bacaPesanan({
          teks: st.teksAI.slice(0, 4000),
          gambar: gambarStruk,
          anggota: aktif.map((x) => x.nama),
          penalang: namaDari(st.penalang_id),
          kunciGemini: a.gemini,
          kunciGroq: a.groq,
        });
        terapkanAI(r);
        gambarItems();
        gambarFooter();
        status.textContent = `Terbaca ${r.items.length} menu dan ${r.biaya.length} biaya. Cek dulu, lalu lanjut.`;
      } catch (x) {
        status.className = 'error';
        status.textContent = x.message;
      } finally {
        tombolAI.disabled = false;
      }
    }

    gambarItems();
    return [
      el('section.kartu.tumpuk-kecil', {},
        el('label.field', {}, 'Pesan dari mana?', el('input', { value: st.resto, placeholder: 'Misal Warteg Bahari', maxlength: 60, oninput: (e) => { st.resto = e.target.value; } })),
        el('label.field', {}, 'Tanggal', el('input', { type: 'date', value: st.tanggal, oninput: (e) => { st.tanggal = e.target.value || hariIni(); } })),
        el('div.field', {}, el('span', {}, 'Siapa yang nalangin?'), chipsPenalang())),
      el('section.kartu.ai.tumpuk-kecil', {},
        el('h3', {}, ikon('kilau'), 'Biar AI yang isi'),
        el('p.sub', {}, 'Tempel pesanan dari chat grup, atau pilih foto struk atau screenshot order. AI mengisi menu dan biaya, kamu tinggal cek.'),
        teks,
        el('div.sejajar', {}, el('label.btn.kecil', {}, ikon('kamera'), 'Foto struk', inputFoto), namaFoto, el('span.spasi'), tombolAI),
        status),
      el('h2.judul-bagian', {}, 'Siapa makan apa?'),
      daftar,
      el('button.btn.garis', {
        type: 'button',
        onclick: () => {
          st.items.push(itemBaru());
          gambarItems();
          daftar.lastElementChild?.querySelector('input')?.focus();
        },
      }, ikon('tambah'), 'Tambah menu'),
    ];
  }

  function terapkanAI(r) {
    const cari = (n) => aktif.find((a) => a.nama.toLowerCase() === String(n).trim().toLowerCase())?.id;
    if (r.items.length) {
      st.items = r.items.map((it) => itemBaru({
        nama_item: it.nama_item,
        harga_satuan: it.harga_satuan,
        qty: it.qty,
        sumber: 'ai',
        porsi: new Set(it.pemesan.map(cari).filter(Boolean)),
      }));
    }
    if (r.biaya.length) {
      st.biaya = biayaAwal();
      for (const b of r.biaya) {
        const ada = st.biaya.find((x) => x.nama_biaya.toLowerCase() === b.nama_biaya.toLowerCase());
        if (ada) ada.nominal = b.nominal;
        else st.biaya.push({ nama_biaya: b.nama_biaya, nominal: b.nominal, potongan: b.potongan, cara_bagi: b.potongan ? 'sebanding' : 'rata' });
      }
    }
    st.total_struk = r.total_struk;
  }

  // Langkah 2: ongkir dan biaya
  function langkahBiaya() {
    const daftar = el('div');
    const teksBagi = (b) => (b.cara_bagi === 'rata' ? 'dibagi rata ⇄' : 'sesuai pesanan ⇄');

    function barisBiaya(b) {
      const toggle = el('button.toggle-bagi', {
        type: 'button',
        title: 'Ganti cara bagi',
        onclick: () => {
          b.cara_bagi = b.cara_bagi === 'rata' ? 'sebanding' : 'rata';
          toggle.textContent = teksBagi(b);
          gambarFooter();
        },
      }, teksBagi(b));
      return el(b.potongan ? 'div.biaya.potongan' : 'div.biaya', {},
        el('div.biaya-label', {},
          b.bawaan
            ? el('span.biaya-nama', {}, b.nama_biaya)
            : el('input', { value: b.nama_biaya, placeholder: 'Nama biaya', maxlength: 40, 'aria-label': 'Nama biaya', oninput: (e) => { b.nama_biaya = e.target.value; } }),
          toggle,
          b.bawaan
            ? null
            : el('label.cek-mini', {},
                el('input', { type: 'checkbox', checked: b.potongan, onchange: (e) => { b.potongan = e.target.checked; gambarBiaya(); gambarFooter(); } }),
                'ini potongan')),
        el('label.uang', {}, el('span', {}, b.potongan ? '−Rp' : 'Rp'),
          el('input', { type: 'number', inputmode: 'numeric', min: 0, step: 500, value: b.nominal || '', placeholder: '0', 'aria-label': `Nominal ${b.nama_biaya || 'biaya lain'}`, oninput: (e) => { b.nominal = num(e.target.value); gambarFooter(); } })));
    }

    function gambarBiaya() {
      daftar.replaceChildren(...st.biaya.filter((b) => st.semuaBiaya || !b.bawaan || BIAYA_UTAMA.has(b.nama_biaya) || b.nominal > 0).map(barisBiaya));
    }
    gambarBiaya();

    const tersembunyi = st.biaya.some((b) => b.bawaan && !BIAYA_UTAMA.has(b.nama_biaya) && !b.nominal);
    return [
      el('section.kartu', {},
        el('h2', {}, 'Ongkir dan biaya lain'),
        el('p.sub', {}, 'Isi sesuai struk. Yang kosong diabaikan.'),
        daftar,
        el('div.tumpuk-kecil.aksi-biaya', {},
          !st.semuaBiaya && tersembunyi
            ? el('button.btn.kecil.penuh', { type: 'button', onclick: (e) => { st.semuaBiaya = true; e.currentTarget.remove(); gambarBiaya(); } }, 'Tampilkan kemasan, tip, pajak, dll')
            : null,
          el('button.btn.kecil.penuh', {
            type: 'button',
            onclick: () => {
              st.biaya.push({ nama_biaya: '', nominal: 0, cara_bagi: 'rata', potongan: false });
              gambarBiaya();
              daftar.lastElementChild?.querySelector('input')?.focus();
            },
          }, ikon('tambah'), 'Tambah biaya lain'))),
      el('section.kartu.tumpuk-kecil', {},
        el('h3', {}, 'Cara bagi'),
        el('p.sub', {}, el('b', {}, 'Dibagi rata'), ': semua orang kena sama besar. Cocok untuk ongkir dan biaya layanan.'),
        el('p.sub', {}, el('b', {}, 'Sesuai pesanan'), ': makin mahal pesananmu, makin besar bagianmu. Cocok untuk pajak dan promo persen.'),
        el('p.catatan', {}, 'Ketuk tulisan oranye di tiap baris untuk mengganti.')),
    ];
  }

  // Langkah 3: cek dan pasang
  function langkahCek() {
    const h = hitungAman();
    if (!h.ok) return [el('section.kartu', {}, el('p.error', {}, h.pesan))];
    const pen = String(st.penalang_id);
    const dariLain = h.peserta.filter((p) => String(p.anggota_id) !== pen).reduce((a, p) => a + p.total, 0);
    return [
      el('section.kartu', {}, el('h2', {}, st.resto), el('p.sub', {}, `${tgl(st.tanggal)} · ditalangin ${namaDari(pen)}`)),
      el('section.kartu', {},
        el('h3', {}, 'Bagian tiap orang'),
        ...h.peserta.map((p) => {
          const n = namaDari(p.anggota_id);
          const rinci = [`menu ${rp(p.subtotal)}`];
          if (Math.round(p.rata)) rinci.push(`rata ${tanda(p.rata)}`);
          if (Math.round(p.sebanding)) rinci.push(`sesuai pesanan ${tanda(p.sebanding)}`);
          return el('div.orang', {},
            avatar(n),
            el('div.isi', {}, el('b', {}, n, String(p.anggota_id) === pen ? el('span.tag', {}, 'nalangin') : null), el('p.sub', {}, rinci.join(' · '))),
            el('span.total', {}, rp(p.total)));
        })),
      el('section.kartu.tumpuk-kecil', {},
        el('div.baris-ringkas', {}, el('span', {}, 'Dibayar ke resto'), el('b', {}, rp(h.total_bayar))),
        el('div.baris-ringkas', {}, el('span', {}, `${namaDari(pen)} akan menerima`), el('b', {}, rp(dariLain))),
        h.selisih ? el('p.catatan', {}, `Sudah termasuk pembulatan ${rp(h.selisih)} untuk yang nalangin.`) : null,
        st.total_struk && st.total_struk !== h.total_bayar
          ? el('p.peringatan', {}, `Total di struk ${rp(st.total_struk)}, tapi hitungan ${rp(h.total_bayar)}. Cek lagi menu atau biayanya.`)
          : null),
    ];
  }

  gambar();
  return el('div', {}, wadah, footer);
}

// ---------- Setup (admin, sekali) ----------

async function viewSetup() {
  const isian = (placeholder, label) => el('input', { type: 'password', autocomplete: 'off', placeholder, 'aria-label': label });
  const token = isian('github_pat_…', 'Token GitHub');
  const gemini = isian('Opsional, AIza…', 'Kunci Gemini');
  const groq = isian('Opsional, gsk_…', 'Kunci Groq');
  const kodeLama = isian('Hanya kalau memperbarui kode, MM1…', 'Kode lama');
  const err = el('p.error', { role: 'alert' });
  const hasil = el('div.tumpuk');
  const tombol = el('button.btn.utama.penuh', { type: 'submit' }, 'Buat kode ruangan');
  const tautan = (teks, href) => el('a', { href, target: '_blank', rel: 'noopener' }, teks);
  const namaRepo = DATA_REPO.split('/')[1] ?? 'mading-maksi-data';

  async function kirim(e) {
    e.preventDefault();
    err.textContent = '';
    hasil.replaceChildren();
    const t = token.value.trim();
    if (!t) return void (err.textContent = 'Tempel token GitHub dulu');
    tombol.disabled = true;
    tombol.textContent = 'Memeriksa…';
    try {
      if (!(await gudang.cekAkses(t)).push) throw new Error(`Token belum punya izin "Contents: Read and write" untuk repo ${DATA_REPO}.`);
      const ada = await gudang.baca(t);
      let kunciB64;
      if (ada) {
        if (!kodeLama.value.trim()) throw new Error('Data sudah ada. Tempel kode lama supaya kunci enkripsinya sama dan data lama tetap terbaca.');
        let lama;
        try {
          lama = await bukaKode(kodeLama.value);
          await dekripsiJson(lama.kunci, ada.data.cek);
        } catch {
          throw new Error('Kode lama tidak valid atau tidak cocok dengan data yang ada.');
        }
        kunciB64 = lama.kunciB64;
      } else {
        kunciB64 = kunciBaru();
        const { kunci } = await bukaKode(buatKode({ token: t, kunciB64 }));
        await gudang.buatAwal(t, { versi: 1, cek: await enkripsiJson(kunci, 'mading-maksi'), anggota: [], sesi: [] });
      }
      tampilkanKode(buatKode({ token: t, kunciB64, gemini: gemini.value.trim(), groq: groq.value.trim() }), !ada);
    } catch (x) {
      err.textContent = x.message;
    } finally {
      tombol.disabled = false;
      tombol.textContent = 'Buat kode ruangan';
    }
  }

  function tampilkanKode(kodeBaru, baru) {
    const kotak = el('textarea', { readonly: true, rows: 4, 'aria-label': 'Kode ruangan', value: kodeBaru });
    hasil.replaceChildren(el('section.kartu.panduan.tumpuk-kecil', {},
      el('h2', {}, baru ? 'Mading siap dipakai' : 'Kode baru siap'),
      el('p.sub', {}, 'Salin kode ini dan bagikan ke anggota ruangan saja. Siapa pun yang punya kode bisa mengubah data mading.'),
      kotak,
      el('div.sejajar', {},
        el('button.btn', {
          type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            try {
              await navigator.clipboard.writeText(kodeBaru);
              b.textContent = 'Tersalin';
            } catch {
              kotak.select();
            }
          },
        }, 'Salin kode'),
        el('button.btn.utama', {
          type: 'button',
          onclick: () => {
            kode = kodeBaru;
            akses = null;
            simpan.set('kode', kodeBaru);
            renderKepala();
            location.hash = '#/anggota';
          },
        }, 'Pakai di perangkat ini'))));
    hasil.scrollIntoView({ behavior: 'smooth' });
  }

  const langkah = (no, judul, ...isi) => el('li', {}, el('span.nomor', {}, String(no)), el('div', {}, el('b', {}, judul), el('p.sub', {}, ...isi)));
  return el('div.tumpuk', {},
    el('section.kartu.tumpuk-kecil', {},
      el('h2', {}, 'Setup Mading Maksi'),
      el('p.sub', {}, 'Cukup sekali oleh admin ruangan. Hasilnya satu kode ruangan untuk dibagikan ke anggota.'),
      el('ol.langkah', {},
        langkah(1, 'Buat repo data', 'Repo publik kosong bernama ', el('b', {}, namaRepo), '. ',
          tautan('Buat di GitHub', `https://github.com/new?name=${encodeURIComponent(namaRepo)}&visibility=public&description=Data%20Mading%20Maksi`)),
        langkah(2, 'Buat token GitHub', 'Pilih fine-grained token. Repository access: Only select repositories → ', el('b', {}, namaRepo),
          '. Permissions: Contents → Read and write. Masa berlaku paling lama 1 tahun. ',
          tautan('Buat token', 'https://github.com/settings/personal-access-tokens/new')),
        langkah(3, 'Kunci AI (opsional)', 'Kunci gratis supaya AI bisa membaca struk dan chat pesanan. ',
          tautan('Ambil kunci Gemini', 'https://aistudio.google.com/apikey')))),
    el('form.kartu.tumpuk-kecil', { onsubmit: kirim },
      el('label.field', {}, 'Token GitHub', token),
      el('label.field', {}, 'Kunci Gemini', gemini),
      el('label.field', {}, 'Kunci Groq (cadangan, opsional)', groq),
      el('label.field', {}, 'Kode lama', kodeLama),
      el('p.catatan', {}, 'Token dan kunci hanya dikirim ke GitHub dan layanan AI, lalu disimpan di dalam kode ruangan.'),
      err,
      tombol),
    hasil);
}
