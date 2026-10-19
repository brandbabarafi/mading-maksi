import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatKode, bukaKode, kunciBaru, enkripsiJson, dekripsiJson, enkripsi, dekripsi } from '../public/sandi.js';

test('kode ruangan bolak-balik utuh dan aman untuk URL', async () => {
  const kunciB64 = kunciBaru();
  const kode = buatKode({ token: 'github_pat_contoh_1234567890', kunciB64, gemini: 'AIza-contoh' });
  assert.match(kode, /^MM1\.[A-Za-z0-9_-]+$/);
  const a = await bukaKode(`  ${kode}\n`);
  assert.equal(a.token, 'github_pat_contoh_1234567890');
  assert.equal(a.kunciB64, kunciB64);
  assert.equal(a.gemini, 'AIza-contoh');
  assert.equal(a.groq, '');
});

test('kode rusak ditolak', async () => {
  await assert.rejects(bukaKode('halo'), /Format kode/);
  await assert.rejects(bukaKode(buatKode({ token: 'pendek', kunciB64: kunciBaru() })), /tidak lengkap/);
});

test('enkripsi JSON bisa dibuka dengan kunci yang sama saja', async () => {
  const a = await bukaKode(buatKode({ token: 'github_pat_contoh_1234567890', kunciB64: kunciBaru() }));
  const b = await bukaKode(buatKode({ token: 'github_pat_contoh_1234567890', kunciB64: kunciBaru() }));
  const rahasia = { items: [{ nama_item: 'Nasi ayam 🍗', harga_satuan: 25000 }] };
  const sandi = await enkripsiJson(a.kunci, rahasia);
  assert.ok(!sandi.includes('Nasi'));
  assert.deepEqual(await dekripsiJson(a.kunci, sandi), rahasia);
  await assert.rejects(dekripsiJson(b.kunci, sandi));
});

test('enkripsi biner untuk foto bukti', async () => {
  const a = await bukaKode(buatKode({ token: 'github_pat_contoh_1234567890', kunciB64: kunciBaru() }));
  const foto = crypto.getRandomValues(new Uint8Array(5000));
  const sandi = await enkripsi(a.kunci, foto);
  assert.equal(sandi.length, foto.length + 12 + 16);
  assert.deepEqual(await dekripsi(a.kunci, sandi), foto);
});
