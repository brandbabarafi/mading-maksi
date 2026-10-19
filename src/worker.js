import { hitung } from '../public/hitung.js';
import { bacaPesanan } from './ai.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const gagal = (status, message) => {
  throw new HttpError(status, message);
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });

// [method, path, handler, perluKode]
const routes = [
  ['GET', /^\/api\/mading$/, mading, false],
  ['GET', /^\/api\/saldo$/, saldo, false],
  ['GET', /^\/api\/anggota$/, daftarAnggota, false],
  ['POST', /^\/api\/kode$/, () => json({ ok: true }), true],
  ['POST', /^\/api\/anggota$/, tambahAnggota, true],
  ['PATCH', /^\/api\/anggota\/(\d+)$/, ubahAnggota, true],
  ['POST', /^\/api\/sesi$/, buatSesi, true],
  ['GET', /^\/api\/sesi\/([\w-]+)$/, detailSesi, true],
  ['POST', /^\/api\/sesi\/([\w-]+)\/batal$/, batalSesi, true],
  ['POST', /^\/api\/peserta\/([\w-]+)\/lunas$/, tandaiLunas, true],
  ['GET', /^\/api\/bukti\/([\w-]+)$/, lihatBukti, true],
  ['POST', /^\/api\/ai\/baca$/, bacaAI, true],
];

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), req, env);
    let res;
    try {
      for (const [method, pola, handler, perluKode] of routes) {
        const m = pathname.match(pola);
        if (!m || req.method !== method) continue;
        if (perluKode) await cekKode(req, env);
        res = await handler(req, env, m[1]);
        break;
      }
      res ??= gagal(404, 'Tidak ditemukan');
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      res = e instanceof HttpError ? json({ error: e.message }, e.status) : json({ error: 'Terjadi kesalahan di server' }, 500);
    }
    return cors(res, req, env);
  },
};

// Halaman di GitHub Pages memanggil API ini dari domain lain, jadi domainnya harus diizinkan.
function cors(res, req, env) {
  const origin = req.headers.get('origin');
  const izin = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !izin.includes(origin)) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', origin);
  h.set('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
  h.set('access-control-allow-headers', 'content-type, x-kode-ruangan');
  h.set('access-control-max-age', '86400');
  h.append('vary', 'origin');
  return new Response(res.body, { status: res.status, headers: h });
}

// ---------- Kode ruangan ----------

const BATAS_GAGAL = 10;
const JENDELA_MS = 15 * 60 * 1000;

async function cekKode(req, env) {
  if (!env.KODE_RUANGAN) gagal(500, 'KODE_RUANGAN belum diatur di server');
  const ip = req.headers.get('cf-connecting-ip') ?? 'lokal';
  const sejak = Date.now() - JENDELA_MS;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM gagal_kode WHERE ip = ? AND waktu > ?')
    .bind(ip, sejak)
    .first();
  if (n >= BATAS_GAGAL) gagal(429, 'Terlalu banyak percobaan kode salah. Coba lagi 15 menit lagi.');

  let kode = '';
  try {
    kode = decodeURIComponent(req.headers.get('x-kode-ruangan') ?? '');
  } catch {}
  if (await samaPersis(kode, env.KODE_RUANGAN)) return;

  await env.DB.batch([
    env.DB.prepare('INSERT INTO gagal_kode (ip, waktu) VALUES (?, ?)').bind(ip, Date.now()),
    env.DB.prepare('DELETE FROM gagal_kode WHERE waktu <= ?').bind(sejak),
  ]);
  gagal(401, 'Kode ruangan salah');
}

async function samaPersis(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

// ---------- Validasi input ----------

async function bacaJson(req) {
  try {
    return await req.json();
  } catch {
    gagal(400, 'Data tidak valid');
  }
}

function teks(v, label, maks) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) gagal(400, `${label} wajib diisi`);
  if (s.length > maks) gagal(400, `${label} maksimal ${maks} karakter`);
  return s;
}

function angka(v, label, min) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) gagal(400, `${label} harus bilangan bulat minimal ${min}`);
  return n;
}

function daftar(v, label, maks) {
  if (!Array.isArray(v)) gagal(400, `${label} tidak valid`);
  if (v.length > maks) gagal(400, `${label} maksimal ${maks} baris`);
  return v;
}

// D1 membatasi 100 parameter per statement, jadi baris dipecah per potongan.
function insertBanyak(db, tabel, kolom, baris) {
  const per = Math.floor(100 / kolom.length);
  const stmts = [];
  for (let i = 0; i < baris.length; i += per) {
    const bagian = baris.slice(i, i + per);
    const tanda = bagian.map(() => `(${kolom.map(() => '?').join(', ')})`).join(', ');
    stmts.push(db.prepare(`INSERT INTO ${tabel} (${kolom.join(', ')}) VALUES ${tanda}`).bind(...bagian.flat()));
  }
  return stmts;
}

// ---------- Publik ----------

async function mading(req, env) {
  const { results: sesi } = await env.DB.prepare(
    `SELECT s.id, s.resto, s.tanggal, s.status, a.nama_panggilan AS penalang, s.penalang_id
     FROM sesi_maksi s JOIN anggota a ON a.id = s.penalang_id
     WHERE s.status != 'batal'
     ORDER BY s.tanggal DESC, s.dibuat_pada DESC
     LIMIT 30`,
  ).all();

  let peserta = [];
  if (sesi.length) {
    ({ results: peserta } = await env.DB.prepare(
      `SELECT p.id, p.sesi_id, p.anggota_id, a.nama_panggilan AS nama, p.total_tagihan, p.status_bayar,
              b.peserta_id IS NOT NULL AS ada_bukti
       FROM peserta_sesi p
       JOIN anggota a ON a.id = p.anggota_id
       LEFT JOIN bukti_bayar b ON b.peserta_id = p.id
       WHERE p.sesi_id IN (${sesi.map(() => '?').join(', ')})
       ORDER BY a.nama_panggilan`,
    )
      .bind(...sesi.map((s) => s.id))
      .all());
  }
  for (const s of sesi) {
    s.peserta = peserta
      .filter((p) => p.sesi_id === s.id)
      .map(({ id, nama, total_tagihan, status_bayar, anggota_id, ada_bukti }) => ({
        id,
        nama,
        total_tagihan,
        status_bayar,
        ada_bukti: Boolean(ada_bukti),
        penalang: anggota_id === s.penalang_id,
      }));
    delete s.penalang_id;
  }

  const belum = await env.DB.prepare(
    `SELECT COALESCE(SUM(p.total_tagihan), 0) AS jumlah, COUNT(*) AS tagihan
     FROM peserta_sesi p JOIN sesi_maksi s ON s.id = p.sesi_id
     WHERE p.status_bayar = 'belum' AND s.status = 'terbuka'`,
  ).first();

  return json({ sesi, belum });
}

async function saldo(req, env) {
  const { results } = await env.DB.prepare(
    `SELECT a.nama_panggilan AS dari, pn.nama_panggilan AS ke, SUM(p.total_tagihan) AS jumlah
     FROM peserta_sesi p
     JOIN sesi_maksi s ON s.id = p.sesi_id
     JOIN anggota a ON a.id = p.anggota_id
     JOIN anggota pn ON pn.id = s.penalang_id
     WHERE p.status_bayar = 'belum' AND s.status = 'terbuka'
     GROUP BY dari, ke`,
  ).all();
  return json({ utang: results });
}

async function daftarAnggota(req, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, nama_panggilan, aktif FROM anggota ORDER BY nama_panggilan',
  ).all();
  return json({ anggota: results, pembulatan: Number(env.PEMBULATAN) || 100 });
}

// ---------- Perlu kode ruangan ----------

async function tambahAnggota(req, env) {
  const b = await bacaJson(req);
  const nama = teks(b.nama_panggilan, 'Nama panggilan', 30);
  try {
    const row = await env.DB.prepare('INSERT INTO anggota (nama_panggilan) VALUES (?) RETURNING id, nama_panggilan, aktif')
      .bind(nama)
      .first();
    return json(row, 201);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) gagal(409, `"${nama}" sudah ada`);
    throw e;
  }
}

async function ubahAnggota(req, env, id) {
  const b = await bacaJson(req);
  const r = await env.DB.prepare('UPDATE anggota SET aktif = ? WHERE id = ?').bind(b.aktif ? 1 : 0, Number(id)).run();
  if (!r.meta.changes) gagal(404, 'Anggota tidak ditemukan');
  return json({ ok: true });
}

async function buatSesi(req, env) {
  const b = await bacaJson(req);
  const resto = teks(b.resto, 'Nama resto', 60);
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(b.tanggal) ? b.tanggal : gagal(400, 'Tanggal tidak valid');
  const penalangId = angka(b.penalang_id, 'Penalang', 1);

  const items = daftar(b.items, 'Item', 50).map((it) => ({
    nama_item: teks(it.nama_item, 'Nama item', 80),
    harga_satuan: angka(it.harga_satuan, 'Harga', 0),
    qty: angka(it.qty, 'Jumlah', 1),
    sumber: it.sumber === 'ai' ? 'ai' : 'manual',
    porsi: Object.fromEntries(
      Object.entries(it.porsi ?? {})
        .map(([id, w]) => [String(angka(id, 'Pemakan', 1)), Number(w)])
        .filter(([, w]) => Number.isFinite(w) && w > 0),
    ),
  }));
  const biaya = daftar(b.biaya ?? [], 'Biaya', 20)
    .map((x) => ({
      nama_biaya: teks(x.nama_biaya, 'Nama biaya', 40),
      nominal: angka(x.nominal, 'Nominal biaya', 0),
      cara_bagi: x.cara_bagi === 'sebanding' ? 'sebanding' : 'rata',
      potongan: Boolean(x.potongan),
    }))
    .filter((x) => x.nominal > 0);

  const idAnggota = [...new Set([penalangId, ...items.flatMap((it) => Object.keys(it.porsi).map(Number))])];
  const { n } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM anggota WHERE aktif = 1 AND id IN (${idAnggota.map(() => '?').join(', ')})`,
  )
    .bind(...idAnggota)
    .first();
  if (n !== idAnggota.length) gagal(400, 'Ada anggota yang tidak dikenal atau sudah nonaktif');

  let h;
  try {
    h = hitung({ items, biaya, pembulatan: Number(env.PEMBULATAN) || 100 });
  } catch (e) {
    gagal(400, e.message);
  }

  const sesiId = crypto.randomUUID();
  const sekarang = new Date().toISOString();
  const pesertaId = new Map(h.peserta.map((p) => [p.anggota_id, crypto.randomUUID()]));
  const semuaLunas = h.peserta.every((p) => Number(p.anggota_id) === penalangId);
  const itemsDenganId = items.map((it) => ({ ...it, id: crypto.randomUUID() }));

  const db = env.DB;
  await db.batch([
    db
      .prepare('INSERT INTO sesi_maksi (id, penalang_id, resto, tanggal, status) VALUES (?, ?, ?, ?, ?)')
      .bind(sesiId, penalangId, resto, tanggal, semuaLunas ? 'lunas' : 'terbuka'),
    ...insertBanyak(
      db,
      'biaya_sesi',
      ['sesi_id', 'nama_biaya', 'nominal', 'cara_bagi', 'potongan'],
      biaya.map((x) => [sesiId, x.nama_biaya, x.nominal, x.cara_bagi, x.potongan ? 1 : 0]),
    ),
    ...insertBanyak(
      db,
      'peserta_sesi',
      ['id', 'sesi_id', 'anggota_id', 'total_tagihan', 'status_bayar', 'lunas_pada'],
      h.peserta.map((p) => {
        const penalang = Number(p.anggota_id) === penalangId;
        return [pesertaId.get(p.anggota_id), sesiId, Number(p.anggota_id), p.total, penalang ? 'lunas' : 'belum', penalang ? sekarang : null];
      }),
    ),
    ...insertBanyak(
      db,
      'item_pesanan',
      ['id', 'sesi_id', 'nama_item', 'harga_satuan', 'qty', 'sumber'],
      itemsDenganId.map((it) => [it.id, sesiId, it.nama_item, it.harga_satuan, it.qty, it.sumber]),
    ),
    ...insertBanyak(
      db,
      'pembagian_item',
      ['item_id', 'peserta_id', 'porsi'],
      itemsDenganId.flatMap((it) => Object.entries(it.porsi).map(([id, w]) => [it.id, pesertaId.get(id), w])),
    ),
  ]);

  return json({ id: sesiId, ...h }, 201);
}

async function detailSesi(req, env, id) {
  const db = env.DB;
  const [sesi, biaya, items, pembagian, peserta] = await db.batch([
    db
      .prepare(
        `SELECT s.id, s.resto, s.tanggal, s.status, s.penalang_id, a.nama_panggilan AS penalang
         FROM sesi_maksi s JOIN anggota a ON a.id = s.penalang_id WHERE s.id = ?`,
      )
      .bind(id),
    db.prepare('SELECT nama_biaya, nominal, cara_bagi, potongan FROM biaya_sesi WHERE sesi_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT id, nama_item, harga_satuan, qty, sumber FROM item_pesanan WHERE sesi_id = ?').bind(id),
    db
      .prepare(
        `SELECT b.item_id, a.nama_panggilan AS nama, b.porsi
         FROM pembagian_item b
         JOIN peserta_sesi p ON p.id = b.peserta_id
         JOIN anggota a ON a.id = p.anggota_id
         WHERE p.sesi_id = ?`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT p.id, a.nama_panggilan AS nama, p.anggota_id, p.total_tagihan, p.status_bayar, p.lunas_pada,
                b.peserta_id IS NOT NULL AS ada_bukti
         FROM peserta_sesi p
         JOIN anggota a ON a.id = p.anggota_id
         LEFT JOIN bukti_bayar b ON b.peserta_id = p.id
         WHERE p.sesi_id = ? ORDER BY a.nama_panggilan`,
      )
      .bind(id),
  ]);
  const s = sesi.results[0] ?? gagal(404, 'Sesi tidak ditemukan');
  return json({
    ...s,
    biaya: biaya.results.map((x) => ({ ...x, potongan: Boolean(x.potongan) })),
    items: items.results.map((it) => ({
      ...it,
      pemakan: pembagian.results.filter((p) => p.item_id === it.id).map(({ nama, porsi }) => ({ nama, porsi })),
    })),
    peserta: peserta.results.map((p) => ({ ...p, ada_bukti: Boolean(p.ada_bukti), penalang: p.anggota_id === s.penalang_id })),
  });
}

async function batalSesi(req, env, id) {
  const r = await env.DB.prepare("UPDATE sesi_maksi SET status = 'batal' WHERE id = ?").bind(id).run();
  if (!r.meta.changes) gagal(404, 'Sesi tidak ditemukan');
  return json({ ok: true });
}

const BUKTI_MAKS_BYTE = 1_500_000;
const BUKTI_UMUR_MS = 14 * 24 * 60 * 60 * 1000;

function bacaBukti(b) {
  if (!b) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(b.mime) || typeof b.data !== 'string') gagal(400, 'Bukti harus berupa foto');
  let bytes;
  try {
    bytes = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
  } catch {
    gagal(400, 'Foto bukti rusak');
  }
  if (bytes.length > BUKTI_MAKS_BYTE) gagal(413, 'Foto bukti terlalu besar');
  return { mime: b.mime, bytes };
}

// Peserta mencentang sendiri "sudah bayar", boleh dengan foto bukti. Siapa pun yang pegang kode bisa membatalkan.
async function tandaiLunas(req, env, id) {
  if (Number(req.headers.get('content-length') ?? 0) > 2_500_000) gagal(413, 'Foto bukti terlalu besar');
  const b = await bacaJson(req);
  const lunas = Boolean(b.lunas);
  const bukti = lunas ? bacaBukti(b.bukti) : null;
  const db = env.DB;
  const sekarang = Date.now();
  const [ubah] = await db.batch([
    db
      .prepare(
        `UPDATE peserta_sesi SET status_bayar = ?, lunas_pada = ?
         WHERE id = ?
           AND anggota_id != (SELECT penalang_id FROM sesi_maksi WHERE id = peserta_sesi.sesi_id)
           AND (SELECT status FROM sesi_maksi WHERE id = peserta_sesi.sesi_id) != 'batal'`,
      )
      .bind(lunas ? 'lunas' : 'belum', lunas ? new Date().toISOString() : null, id),
    db
      .prepare(
        `UPDATE sesi_maksi
         SET status = CASE WHEN EXISTS (
           SELECT 1 FROM peserta_sesi WHERE sesi_id = sesi_maksi.id AND status_bayar = 'belum'
         ) THEN 'terbuka' ELSE 'lunas' END
         WHERE id = (SELECT sesi_id FROM peserta_sesi WHERE id = ?) AND status != 'batal'`,
      )
      .bind(id),
    // Hanya menyentuh bukti kalau baris peserta di atas benar-benar berubah.
    lunas && bukti
      ? db
          .prepare(
            `INSERT INTO bukti_bayar (peserta_id, mime, data, diunggah_pada)
             SELECT ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM peserta_sesi p JOIN sesi_maksi s ON s.id = p.sesi_id
               WHERE p.id = ? AND p.status_bayar = 'lunas' AND p.anggota_id != s.penalang_id AND s.status != 'batal'
             )
             ON CONFLICT (peserta_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, diunggah_pada = excluded.diunggah_pada`,
          )
          .bind(id, bukti.mime, bukti.bytes, sekarang, id)
      : db.prepare(`DELETE FROM bukti_bayar WHERE peserta_id = ? AND ? = 0`).bind(id, lunas ? 1 : 0),
    db.prepare('DELETE FROM bukti_bayar WHERE diunggah_pada < ?').bind(sekarang - BUKTI_UMUR_MS),
  ]);
  if (!ubah.meta.changes) gagal(400, 'Tagihan tidak ditemukan, milik penalang, atau sesinya sudah dibatalkan');
  return json({ ok: true });
}

async function lihatBukti(req, env, id) {
  const row = await env.DB.prepare('SELECT mime, data FROM bukti_bayar WHERE peserta_id = ?').bind(id).first();
  if (!row) gagal(404, 'Belum ada bukti');
  return new Response(new Uint8Array(row.data), {
    headers: { 'content-type': row.mime, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
  });
}

async function bacaAI(req, env) {
  if (Number(req.headers.get('content-length') ?? 0) > 8_000_000) gagal(413, 'Foto terlalu besar');
  const b = await bacaJson(req);
  const teksPesanan = typeof b.teks === 'string' ? b.teks.slice(0, 4000) : '';
  const g = b.gambar;
  const gambar =
    g && /^image\/(jpeg|png|webp)$/.test(g.mime) && typeof g.data === 'string' ? { mime: g.mime, data: g.data } : null;
  if (!teksPesanan.trim() && !gambar) gagal(400, 'Isi teks pesanan atau pilih foto struk dulu');

  const { results } = await env.DB.prepare('SELECT nama_panggilan FROM anggota WHERE aktif = 1').all();
  const penalang = typeof b.penalang === 'string' ? b.penalang.slice(0, 30) : '';
  try {
    return json(await bacaPesanan(env, { teks: teksPesanan, gambar, anggota: results.map((r) => r.nama_panggilan), penalang }));
  } catch (e) {
    console.error('AI gagal:', e.message);
    gagal(502, e.publik ?? 'AI belum bisa membaca pesanan. Coba lagi atau isi manual.');
  }
}
