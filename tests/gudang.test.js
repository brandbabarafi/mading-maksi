import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gudangGitHub } from '../public/gudang.js';
import { dariB64 } from '../public/sandi.js';

// GitHub tiruan: cukup Contents API, raw.githubusercontent.com, dan info repo.
function githubPalsu({ batasPublikHabis = false } = {}) {
  const files = new Map();
  const log = [];
  let urutan = 0;
  let sebelumPut = null;

  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const method = opts.method ?? 'GET';
    const headers = opts.headers ?? {};
    log.push(`${method} ${u.hostname}${u.pathname}`);

    if (u.hostname === 'raw.githubusercontent.com') {
      const f = files.get(u.pathname.split('/').slice(4).join('/'));
      return f ? new Response(new TextDecoder().decode(dariB64(f.b64))) : new Response('404', { status: 404 });
    }

    const [, path] = u.pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (!path) return Response.json({ permissions: { push: headers.authorization === 'Bearer token-benar' } });

    const f = files.get(path);
    if (method === 'GET') {
      if (!headers.authorization && batasPublikHabis) {
        return Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
      }
      if (!f) return Response.json({ message: 'Not Found' }, { status: 404 });
      const etag = `"${f.sha}"`;
      if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
      return Response.json({ sha: f.sha, content: f.b64.replace(/(.{60})/g, '$1\n') }, { headers: { etag } });
    }

    const body = JSON.parse(opts.body);
    if (method === 'PUT') {
      if (sebelumPut) {
        const kait = sebelumPut;
        sebelumPut = null;
        await kait();
      }
      const kini = files.get(path);
      if (kini && !body.sha) return Response.json({ message: "sha wasn't supplied" }, { status: 422 });
      if (kini && body.sha !== kini.sha) return Response.json({ message: 'conflict' }, { status: 409 });
      files.set(path, { sha: `s${++urutan}`, b64: body.content });
      return Response.json({}, { status: kini ? 200 : 201 });
    }
    if (method === 'DELETE') {
      if (!f) return Response.json({ message: 'Not Found' }, { status: 404 });
      if (body.sha !== f.sha) return Response.json({ message: 'conflict' }, { status: 409 });
      files.delete(path);
      return Response.json({});
    }
    throw new Error(`metode tidak didukung: ${method}`);
  }

  return {
    fetch,
    files,
    log,
    kaitSebelumPut(fn) {
      sebelumPut = fn;
    },
  };
}

const buat = (palsu, cache) => gudangGitHub({ repo: 'kami/data', ambil: palsu.fetch, cache });
const awal = () => ({ versi: 1, anggota: [{ id: 'a', nama: 'Andi ✓', aktif: true }], sesi: [] });

test('buat data awal lalu baca kembali, termasuk huruf non-ASCII', async () => {
  const palsu = githubPalsu();
  const g = buat(palsu);
  assert.equal(await g.baca('token-benar'), null);
  await g.buatAwal('token-benar', awal());
  const { data, sha } = await g.baca('token-benar');
  assert.deepEqual(data, awal());
  assert.equal(sha, 's1');
  await assert.rejects(g.buatAwal('token-benar', awal()), /sudah ada/);
});

test('tulis menerapkan perubahan dan mengembalikan hasil mutasi', async () => {
  const palsu = githubPalsu();
  const g = buat(palsu);
  await g.buatAwal('token-benar', awal());
  const { hasil } = await g.tulis('token-benar', (d) => {
    d.anggota.push({ id: 'b', nama: 'Sari', aktif: true });
    return 'oke';
  }, 'Tambah Sari');
  assert.equal(hasil, 'oke');
  assert.deepEqual((await g.baca('token-benar')).data.anggota.map((a) => a.nama), ['Andi ✓', 'Sari']);
});

test('dua orang menyimpan bersamaan: tidak ada perubahan yang hilang', async () => {
  const palsu = githubPalsu();
  const g = buat(palsu);
  await g.buatAwal('token-benar', awal());
  // Tepat sebelum kita menyimpan, orang lain menyimpan duluan.
  palsu.kaitSebelumPut(() => g.tulis('token-benar', (d) => { d.anggota.push({ id: 'c', nama: 'Dodi', aktif: true }); }, 'Tambah Dodi'));
  await g.tulis('token-benar', (d) => { d.anggota.push({ id: 'b', nama: 'Sari', aktif: true }); }, 'Tambah Sari');
  const nama = (await g.baca('token-benar')).data.anggota.map((a) => a.nama);
  assert.deepEqual(nama.sort(), ['Andi ✓', 'Dodi', 'Sari']);
});

test('pengunjung tanpa token memakai ETag: jawaban 304 memakai data cache', async () => {
  const palsu = githubPalsu();
  const g0 = buat(palsu);
  await g0.buatAwal('token-benar', awal());
  const cache = { simpan(o) { Object.assign(this, o); } };
  const g = buat(palsu, cache);
  const pertama = await g.baca();
  assert.equal(cache.etag, '"s1"');
  const kedua = await g.baca();
  assert.deepEqual(kedua.data, pertama.data);
  await g0.tulis('token-benar', (d) => { d.sesi.push({ id: 'x' }); }, 'Sesi baru');
  assert.equal((await g.baca()).data.sesi.length, 1);
});

test('batas akses publik habis: pakai salinan raw dan tandai basi', async () => {
  const palsu = githubPalsu({ batasPublikHabis: true });
  const g = buat(palsu);
  await g.buatAwal('token-benar', awal());
  const h = await g.baca();
  assert.equal(h.basi, true);
  assert.deepEqual(h.data, awal());
  assert.ok(palsu.log.some((l) => l.startsWith('GET raw.githubusercontent.com')));
});

test('simpan, ambil, dan hapus file biner', async () => {
  const palsu = githubPalsu();
  const g = buat(palsu);
  const isi = btoa(String.fromCharCode(0, 255, 7, 128));
  await g.simpanFile('token-benar', 'bukti/p1.bin', isi, 'Bukti');
  assert.deepEqual([...await g.ambilFile('token-benar', 'bukti/p1.bin')], [0, 255, 7, 128]);
  await g.simpanFile('token-benar', 'bukti/p1.bin', btoa('ganti'), 'Bukti baru');
  assert.equal(new TextDecoder().decode(await g.ambilFile('token-benar', 'bukti/p1.bin')), 'ganti');
  await g.hapusFile('token-benar', 'bukti/p1.bin', 'Hapus');
  assert.equal(await g.ambilFile('token-benar', 'bukti/p1.bin'), null);
  await g.hapusFile('token-benar', 'bukti/p1.bin', 'Hapus lagi');
});

test('cek izin tulis token', async () => {
  const palsu = githubPalsu();
  const g = buat(palsu);
  assert.deepEqual(await g.cekAkses('token-benar'), { push: true });
  assert.deepEqual(await g.cekAkses('token-baca-saja'), { push: false });
});
