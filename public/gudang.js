// Tempat data: satu file data.json di repo GitHub publik, dibaca dan ditulis lewat GitHub REST API.
// Pengunjung tanpa kode membaca tanpa token; pemegang kode menulis dengan token dari kode ruangan.
import { dariB64, keB64 } from './sandi.js';

const API = 'https://api.github.com';
const FILE = 'data.json';
const keTeks = (b64) => new TextDecoder().decode(dariB64(b64));
const keBase64 = (teks) => keB64(new TextEncoder().encode(teks));

export class GagalGudang extends Error {
  constructor(pesan, status) {
    super(pesan);
    this.status = status;
  }
}

async function galat(r) {
  const d = await r.json().catch(() => ({}));
  const habis = r.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(d.message ?? '');
  if (r.status === 401) return new GagalGudang('Token GitHub tidak berlaku atau sudah kedaluwarsa.', 401);
  if ((r.status === 403 || r.status === 429) && habis) return new GagalGudang('GitHub sedang membatasi akses. Coba lagi beberapa menit lagi.', 429);
  if (r.status === 403) return new GagalGudang('Token tidak punya izin untuk repo data.', 403);
  if (r.status === 404) return new GagalGudang('Repo data tidak ditemukan, atau token tidak punya akses ke repo itu.', 404);
  return new GagalGudang(`GitHub menolak permintaan (${r.status}) ${d.message ?? ''}`.trim(), r.status);
}

// cache (opsional): { etag, data, sha, simpan(obj) } untuk baca bersyarat tanpa token.
// Jawaban 304 "tidak berubah" tidak dihitung ke batas 60 permintaan per jam milik GitHub.
export function gudangGitHub({ repo, ambil = (...a) => fetch(...a), cache = null }) {
  async function minta(path, { token, method = 'GET', body, headers = {} } = {}) {
    const h = { accept: 'application/vnd.github+json', ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body) h['content-type'] = 'application/json';
    try {
      return await ambil(`${API}/repos/${repo}${path}`, { method, headers: h, body: body && JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new GagalGudang('Tidak bisa terhubung ke GitHub. Cek internet lalu coba lagi.', 0);
    }
  }

  async function infoFile(path, token) {
    const r = await minta(`/contents/${path}`, { token });
    if (r.status === 404) return null;
    if (!r.ok) throw await galat(r);
    const d = await r.json();
    return { sha: d.sha, b64: d.content ?? '' };
  }

  // Salinan raw.githubusercontent.com bisa tertinggal sampai 5 menit; dipakai hanya kalau API dibatasi.
  async function bacaSalinan() {
    let r;
    try {
      r = await ambil(`https://raw.githubusercontent.com/${repo}/main/${FILE}`, { cache: 'no-store' });
    } catch {
      throw new GagalGudang('Tidak bisa terhubung ke GitHub. Cek internet lalu coba lagi.', 0);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new GagalGudang('Data belum bisa dimuat. Coba lagi sebentar lagi.', r.status);
    return { data: await r.json(), sha: null, basi: true };
  }

  async function baca(token) {
    const headers = {};
    if (!token && cache?.etag && cache.data) headers['if-none-match'] = cache.etag;
    const r = await minta(`/contents/${FILE}`, { token, headers });
    if (r.status === 304) return { data: cache.data, sha: cache.sha };
    if (r.status === 404) return null;
    if (!r.ok) {
      const e = await galat(r);
      if (!token && e.status === 429) return bacaSalinan();
      throw e;
    }
    const d = await r.json();
    const data = JSON.parse(keTeks(d.content));
    if (!token) cache?.simpan({ etag: r.headers.get('etag'), data, sha: d.sha });
    return { data, sha: d.sha };
  }

  // Baca, ubah, tulis. Kalau keduluan orang lain (sha berubah), ulangi dengan data terbaru.
  async function tulis(token, mutasi, pesan) {
    for (let coba = 0; coba < 4; coba++) {
      const ada = await baca(token);
      if (!ada) throw new GagalGudang('Data belum disiapkan. Buka halaman Setup dulu.', 404);
      const data = structuredClone(ada.data);
      const hasil = await mutasi(data);
      const r = await minta(`/contents/${FILE}`, {
        token,
        method: 'PUT',
        body: { message: pesan, content: keBase64(JSON.stringify(data, null, 1)), sha: ada.sha },
      });
      if (r.ok) return { data, hasil };
      if (r.status !== 409 && r.status !== 422) throw await galat(r);
    }
    throw new GagalGudang('Banyak yang menyimpan bersamaan. Coba lagi.', 409);
  }

  async function buatAwal(token, data) {
    const r = await minta(`/contents/${FILE}`, {
      token,
      method: 'PUT',
      body: { message: 'Siapkan data Mading Maksi', content: keBase64(JSON.stringify(data, null, 1)) },
    });
    if (r.status === 422 || r.status === 409) throw new GagalGudang('Data sudah ada di repo.', 409);
    if (!r.ok) throw await galat(r);
  }

  async function simpanFile(token, path, b64, pesan) {
    const ada = await infoFile(path, token);
    const r = await minta(`/contents/${path}`, { token, method: 'PUT', body: { message: pesan, content: b64, sha: ada?.sha } });
    if (!r.ok) throw await galat(r);
  }

  async function ambilFile(token, path) {
    const ada = await infoFile(path, token);
    return ada ? dariB64(ada.b64) : null;
  }

  async function hapusFile(token, path, pesan) {
    const ada = await infoFile(path, token);
    if (!ada) return;
    const r = await minta(`/contents/${path}`, { token, method: 'DELETE', body: { message: pesan, sha: ada.sha } });
    if (!r.ok && r.status !== 404) throw await galat(r);
  }

  async function cekAkses(token) {
    const r = await minta('', { token });
    if (!r.ok) throw await galat(r);
    const d = await r.json();
    return { push: Boolean(d.permissions?.push) };
  }

  return { baca, tulis, buatAwal, simpanFile, ambilFile, hapusFile, cekAkses };
}

// Versi lokal untuk mencoba tampilan tanpa GitHub (buka dengan ?demo). Data hanya di browser ini.
export function gudangLokal(store) {
  const k = (path) => `demo:${path}`;
  const baca = async () => {
    const t = store.getItem(k(FILE));
    return t ? { data: JSON.parse(t), sha: 'lokal' } : null;
  };
  return {
    baca,
    async tulis(_token, mutasi) {
      const ada = await baca();
      if (!ada) throw new GagalGudang('Data belum disiapkan. Buka halaman Setup dulu.', 404);
      const data = structuredClone(ada.data);
      const hasil = await mutasi(data);
      store.setItem(k(FILE), JSON.stringify(data));
      return { data, hasil };
    },
    async buatAwal(_token, data) {
      if (store.getItem(k(FILE))) throw new GagalGudang('Data sudah ada di repo.', 409);
      store.setItem(k(FILE), JSON.stringify(data));
    },
    async simpanFile(_token, path, b64) {
      store.setItem(k(path), b64);
    },
    async ambilFile(_token, path) {
      const b = store.getItem(k(path));
      return b ? dariB64(b) : null;
    },
    async hapusFile(_token, path) {
      store.removeItem(k(path));
    },
    async cekAkses() {
      return { push: true };
    },
  };
}
