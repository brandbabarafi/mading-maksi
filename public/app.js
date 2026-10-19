import { hitung, BIAYA_BAWAAN } from './hitung.js';
import { API_BASE } from './config.js';
import { ikon } from './ikon.js';

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

let kode = simpan.get('kode') ?? '';

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (kode) headers['x-kode-ruangan'] = encodeURIComponent(kode);
  let r;
  try {
    r = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Tidak bisa terhubung ke server. Cek internet lalu coba lagi.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    kode = '';
    simpan.set('kode', null);
    renderKepala();
  }
  if (!r.ok) throw new Error(data.error ?? `Gagal (${r.status})`);
  return data;
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
  const input = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Ketik kode ruangan', 'aria-label': 'Kode ruangan' });
  const err = el('p.error', { role: 'alert' });
  const tombol = el('button.btn.utama', { type: 'submit' }, 'Buka');
  return el('form.tumpuk-kecil', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const nilai = input.value.trim();
      if (!nilai) {
        err.textContent = 'Isi kode ruangan dulu';
        input.focus();
        return;
      }
      tombol.disabled = true;
      kode = nilai;
      try {
        await api('/api/kode', { method: 'POST' });
        simpan.set('kode', kode);
        renderKepala();
        toast('Kode tersimpan di perangkat ini');
        lanjut();
      } catch (x) {
        kode = '';
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
        kode = '';
        simpan.set('kode', null);
        tutupSheet();
        toast('Perangkat ini kembali ke mode lihat');
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
    el('p.sub', {}, 'Yang tampil ke publik cuma nama panggilan dan nominal. Rincian menu dan bukti transfer hanya untuk yang punya kode, dan bukti terhapus otomatis setelah 14 hari.'),
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
];

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
    if (ini === giliran) $app.replaceChildren(isi);
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
render();

// ---------- Mading ----------

async function viewMading() {
  const { sesi, belum } = await api('/api/mading');
  const isi = el('div.tumpuk');
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
  const lunas = sesi.filter((s) => s.status === 'lunas');
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
        await api(`/api/peserta/${p.id}/lunas`, { method: 'POST', body: { lunas: true, bukti } });
        toast(`${p.nama} sudah bayar`);
        render();
      } catch (x) {
        err.textContent = x.message;
        kirim.disabled = false;
      }
    },
  }, ikon('cek'), 'Sudah bayar');

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
        await api(`/api/peserta/${p.id}/lunas`, { method: 'POST', body: { lunas: false } });
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
    const r = await fetch(`${API_BASE}/api/bukti/${p.id}`, { headers: { 'x-kode-ruangan': encodeURIComponent(kode) } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Bukti tidak bisa dimuat');
    tempat.replaceChildren(el('img', { src: URL.createObjectURL(await r.blob()), alt: `Bukti transfer ${p.nama}` }));
  } catch (x) {
    tempat.replaceChildren(el('p.error', {}, x.message));
  }
}

// ---------- Saldo ----------

async function viewSaldo() {
  const [{ anggota }, { utang }] = await Promise.all([api('/api/anggota'), api('/api/saldo')]);
  let saya = simpan.get('saya') ?? '';
  const chips = el('div.chips', { role: 'radiogroup', 'aria-label': 'Kamu siapa?' });
  const hasil = el('div.tumpuk');

  function gambarChips() {
    chips.replaceChildren(...anggota
      .filter((a) => a.aktif || a.nama_panggilan === saya)
      .map((a) => el('button.chip', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(a.nama_panggilan === saya),
        onclick: () => {
          saya = a.nama_panggilan;
          simpan.set('saya', saya);
          gambarChips();
          tampil();
        },
      }, avatar(a.nama_panggilan, true), a.nama_panggilan)));
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
  const s = await api(`/api/sesi/${id}`);
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
              await api(`/api/sesi/${id}/batal`, { method: 'POST' });
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
  const { anggota } = await api('/api/anggota');
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
          if (!input.value.trim()) return void (err.textContent = 'Isi nama panggilan dulu');
          try {
            await api('/api/anggota', { method: 'POST', body: { nama_panggilan: input.value } });
            toast(`${input.value.trim()} ditambahkan`);
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
            avatar(a.nama_panggilan),
            el('div.isi', {}, el('b', {}, a.nama_panggilan), a.aktif ? null : el('p.sub', {}, 'Nonaktif, tidak muncul di pilihan')),
            el('button.btn.kecil', {
              type: 'button',
              onclick: async () => {
                try {
                  await api(`/api/anggota/${a.id}`, { method: 'PATCH', body: { aktif: !a.aktif } });
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
  const { anggota, pembulatan } = await api('/api/anggota');
  const aktif = anggota.filter((a) => a.aktif);
  if (!aktif.length) {
    return el('section.kartu.kosong', {},
      el('div.ikon-besar', {}, ikon('orang')),
      el('h2', {}, 'Tambahkan anggota dulu'),
      el('p.sub', {}, 'Patungan butuh daftar nama panggilan orang di ruangan.'),
      el('a.btn.utama', { href: '#/anggota' }, ikon('tambah'), 'Tambah anggota'));
  }

  const tersimpan = Number(simpan.get('penalang'));
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

  const namaDari = (id) => aktif.find((a) => String(a.id) === String(id))?.nama_panggilan ?? '?';
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
      await api('/api/sesi', {
        method: 'POST',
        body: {
          resto: st.resto,
          tanggal: st.tanggal,
          penalang_id: st.penalang_id,
          items: itemsSiap().map(({ nama_item, harga_satuan, qty, sumber, porsi }) => ({ nama_item, harga_satuan, qty, sumber, porsi })),
          biaya: st.biaya.filter((b) => b.nominal > 0).map(({ nama_biaya, nominal, cara_bagi, potongan }) => ({ nama_biaya, nominal, cara_bagi, potongan })),
        },
      });
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
      }, avatar(a.nama_panggilan, true), a.nama_panggilan)));
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
          }, avatar(a.nama_panggilan, true), a.nama_panggilan)),
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
        const r = await api('/api/ai/baca', { method: 'POST', body: { teks: st.teksAI, gambar: gambarStruk, penalang: namaDari(st.penalang_id) } });
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
    const cari = (n) => aktif.find((a) => a.nama_panggilan.toLowerCase() === String(n).trim().toLowerCase())?.id;
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
