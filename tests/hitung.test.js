import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitung } from '../public/hitung.js';

const total = (h, id) => h.peserta.find((p) => p.anggota_id === id).total;

test('contoh di PRD: ongkir rata, promo sebanding', () => {
  const h = hitung({
    items: [
      { nama_item: 'Nasi ayam', harga_satuan: 25000, qty: 1, porsi: { 1: 1 } },
      { nama_item: 'Mie goreng', harga_satuan: 20000, qty: 1, porsi: { 2: 1 } },
      { nama_item: 'Nasi ayam + es teh', harga_satuan: 30000, qty: 1, porsi: { 3: 1 } },
    ],
    biaya: [
      { nominal: 9000, cara_bagi: 'rata', potongan: false },
      { nominal: 15000, cara_bagi: 'sebanding', potongan: true },
    ],
  });
  assert.equal(total(h, '1'), 23000);
  assert.equal(total(h, '2'), 19000);
  assert.equal(total(h, '3'), 27000);
  assert.equal(h.total_bayar, 69000);
  assert.equal(h.selisih, 0);
});

test('item dimakan bareng dan pembulatan ke atas untuk penalang', () => {
  const h = hitung({
    items: [
      { nama_item: 'Nasi ayam', harga_satuan: 25000, qty: 1, porsi: { 1: 1 } },
      { nama_item: 'Mie goreng', harga_satuan: 20000, qty: 1, porsi: { 2: 1 } },
      { nama_item: 'Nasi ayam + es teh', harga_satuan: 30000, qty: 1, porsi: { 3: 1 } },
      { nama_item: 'Kerupuk', harga_satuan: 2000, qty: 3, porsi: { 1: 1, 2: 1, 3: 1 } },
    ],
    biaya: [
      { nominal: 9000, cara_bagi: 'rata', potongan: false },
      { nominal: 3000, cara_bagi: 'rata', potongan: false },
      { nominal: 3000, cara_bagi: 'rata', potongan: false },
      { nominal: 15000, cara_bagi: 'sebanding', potongan: true },
    ],
  });
  assert.equal(total(h, '1'), 27000);
  assert.equal(total(h, '2'), 23000);
  assert.equal(total(h, '3'), 31100);
  assert.equal(h.total_bayar, 81000);
  assert.equal(h.selisih, 100);
});

test('pajak sebanding dan porsi berbobot', () => {
  const h = hitung({
    items: [{ nama_item: 'Pizza', harga_satuan: 100000, qty: 1, porsi: { a: 3, b: 1 } }],
    biaya: [{ nominal: 10000, cara_bagi: 'sebanding', potongan: false }],
    pembulatan: 1,
  });
  assert.equal(total(h, 'a'), 82500);
  assert.equal(total(h, 'b'), 27500);
});

test('item tanpa pemakan ditolak', () => {
  assert.throws(
    () => hitung({ items: [{ nama_item: 'Es teh', harga_satuan: 5000, qty: 1, porsi: {} }] }),
    /Pilih siapa yang makan "Es teh"/,
  );
});

test('potongan melebihi total ditolak', () => {
  assert.throws(
    () =>
      hitung({
        items: [{ nama_item: 'Es teh', harga_satuan: 5000, qty: 1, porsi: { 1: 1 } }],
        biaya: [{ nominal: 6000, cara_bagi: 'sebanding', potongan: true }],
      }),
    /Potongan lebih besar/,
  );
});
