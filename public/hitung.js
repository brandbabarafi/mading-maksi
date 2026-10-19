// Rumus patungan. Dipakai browser untuk pratinjau dan Worker sebagai sumber kebenaran.
//
// bagian_i = S_i + R / n + Q * S_i / ΣS
//   S_i = subtotal menu orang i (termasuk bagiannya dari item yang dimakan bareng)
//   R   = jumlah baris biaya "rata", Q = jumlah baris biaya "sebanding"; potongan bernilai negatif
//   n   = jumlah peserta (siapa pun yang punya porsi di minimal satu item)

export const BIAYA_BAWAAN = [
  { nama_biaya: 'Ongkir', cara_bagi: 'rata', potongan: false },
  { nama_biaya: 'Biaya layanan', cara_bagi: 'rata', potongan: false },
  { nama_biaya: 'Biaya kemasan', cara_bagi: 'rata', potongan: false },
  { nama_biaya: 'Tip driver', cara_bagi: 'rata', potongan: false },
  { nama_biaya: 'Pajak (PB1)', cara_bagi: 'sebanding', potongan: false },
  { nama_biaya: 'Service charge', cara_bagi: 'sebanding', potongan: false },
  { nama_biaya: 'Promo ongkir', cara_bagi: 'rata', potongan: true },
  { nama_biaya: 'Promo makanan', cara_bagi: 'sebanding', potongan: true },
];

// items: [{ nama_item, harga_satuan, qty, porsi: { [anggotaId]: bobot } }]
// biaya: [{ nominal, cara_bagi: 'rata' | 'sebanding', potongan }]
export function hitung({ items, biaya = [], pembulatan = 100 }) {
  if (!items.length) throw new Error('Tambahkan minimal satu item pesanan');

  const subtotal = new Map();
  for (const it of items) {
    const porsi = Object.entries(it.porsi).filter(([, w]) => w > 0);
    const bobot = porsi.reduce((a, [, w]) => a + w, 0);
    if (!bobot) throw new Error(`Pilih siapa yang makan "${it.nama_item || 'item tanpa nama'}"`);
    const total = it.harga_satuan * it.qty;
    for (const [id, w] of porsi) subtotal.set(id, (subtotal.get(id) ?? 0) + (total * w) / bobot);
  }

  const totalMenu = [...subtotal.values()].reduce((a, b) => a + b, 0);
  if (totalMenu <= 0) throw new Error('Total harga pesanan masih Rp0');

  let rata = 0;
  let sebanding = 0;
  for (const b of biaya) {
    const v = b.potongan ? -b.nominal : b.nominal;
    if (b.cara_bagi === 'sebanding') sebanding += v;
    else rata += v;
  }

  const totalBayar = totalMenu + rata + sebanding;
  if (totalBayar <= 0) throw new Error('Potongan lebih besar dari total pesanan');

  const n = subtotal.size;
  const peserta = [...subtotal].map(([anggota_id, s]) => {
    const r = rata / n;
    const q = (sebanding * s) / totalMenu;
    // Math.round dulu supaya sisa float seperti 23000.0000001 tidak terbulatkan ke atas.
    const total = Math.max(0, Math.ceil(Math.round(s + r + q) / pembulatan) * pembulatan);
    return { anggota_id, subtotal: s, rata: r, sebanding: q, total };
  });

  const totalTagihan = peserta.reduce((a, p) => a + p.total, 0);
  return {
    peserta,
    total_bayar: Math.round(totalBayar),
    total_tagihan: totalTagihan,
    selisih: totalTagihan - Math.round(totalBayar),
  };
}
