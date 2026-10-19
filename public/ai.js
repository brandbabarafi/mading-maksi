// AI hanya mengubah struk/teks jadi daftar menu dan biaya. Hitungan uang tetap di hitung.js.
// Dipanggil langsung dari browser dengan kunci yang ada di kode ruangan.
import { GEMINI_MODEL, GROQ_MODEL } from './config.js';

const NAMA_BIAYA = 'Ongkir, Biaya layanan, Biaya kemasan, Tip driver, Pajak (PB1), Service charge, Promo ongkir, Promo makanan';

function buatPrompt({ teks, anggota, penalang }) {
  return `Kamu membaca pesanan makan siang patungan di kantor. Balas JSON saja, tanpa teks lain.

Anggota ruangan (nama panggilan): ${anggota.join(', ') || '(belum ada)'}.
${penalang ? `Kata "aku", "saya", "gue", atau "gw" berarti ${penalang}.` : ''}

Format:
{"items":[{"nama_item":"Nasi ayam","harga_satuan":25000,"qty":1,"pemesan":["Andi"]}],
 "biaya":[{"nama_biaya":"Ongkir","nominal":9000,"potongan":false}],
 "total_struk":69000}

Aturan:
- Semua harga dalam rupiah bulat. "25rb", "25k", "25.000", atau "25" untuk harga makanan berarti 25000.
- harga_satuan = harga satu porsi, qty = jumlah porsi.
- pemesan = nama panggilan persis dari daftar anggota. Item yang dimakan bareng berisi beberapa nama. Kalau tidak jelas, isi [].
- biaya = ongkir, biaya layanan/aplikasi, kemasan, tip, pajak/PB1, service charge (potongan=false) dan promo/diskon (nominal positif, potongan=true). Pakai nama ini bila cocok: ${NAMA_BIAYA}. Selain itu tulis apa adanya.
- total_struk = total akhir yang dibayar menurut struk, atau null kalau tidak ada.
- Jangan menghitung bagian tiap orang. Jangan menambah item yang tidak tertulis.
${teks ? `\nTeks pesanan:\n"""\n${teks}\n"""` : '\nBaca foto struk atau screenshot pesanan terlampir.'}`;
}

async function gemini(kunci, prompt, gambar) {
  const parts = [{ text: prompt }];
  if (gambar) parts.push({ inline_data: { mime_type: gambar.mime, data: gambar.data } });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': kunci },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return JSON.parse((d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''));
}

async function groq(kunci, prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${kunci}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return JSON.parse(d.choices[0].message.content);
}

const bulat = (v, min) => Math.max(min, Math.round(Number(v) || 0));

export function rapikan(h) {
  const items = (Array.isArray(h?.items) ? h.items : []).slice(0, 50).map((it) => ({
    nama_item: String(it?.nama_item ?? '').trim().slice(0, 80),
    harga_satuan: bulat(it?.harga_satuan, 0),
    qty: bulat(it?.qty, 1),
    pemesan: (Array.isArray(it?.pemesan) ? it.pemesan : [it?.pemesan]).filter((x) => typeof x === 'string'),
  }));
  const biaya = (Array.isArray(h?.biaya) ? h.biaya : []).slice(0, 20).map((b) => ({
    nama_biaya: String(b?.nama_biaya ?? '').trim().slice(0, 40),
    nominal: bulat(b?.nominal, 0),
    potongan: Boolean(b?.potongan),
  }));
  const total = Number(h?.total_struk);
  return {
    items: items.filter((it) => it.nama_item),
    biaya: biaya.filter((b) => b.nama_biaya && b.nominal > 0),
    total_struk: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
  };
}

export async function bacaPesanan({ teks, gambar, anggota, penalang, kunciGemini, kunciGroq }) {
  if (!kunciGemini && !(kunciGroq && !gambar)) {
    throw new Error(gambar
      ? 'Kode ruangan ini belum berisi kunci Gemini untuk membaca foto. Minta admin membuat ulang kode lewat Setup.'
      : 'Kode ruangan ini belum berisi kunci AI. Minta admin membuat ulang kode lewat Setup.');
  }
  const prompt = buatPrompt({ teks, anggota, penalang });
  const masalah = [];
  if (kunciGemini) {
    try {
      return rapikan(await gemini(kunciGemini, prompt, gambar));
    } catch (e) {
      masalah.push(e.message);
    }
  }
  if (kunciGroq && !gambar) {
    try {
      return rapikan(await groq(kunciGroq, prompt));
    } catch (e) {
      masalah.push(e.message);
    }
  }
  console.error('AI gagal:', masalah.join(' | '));
  throw new Error(gambar ? 'AI belum bisa membaca foto. Coba lagi, tempel teks, atau isi manual.' : 'AI belum bisa membaca teks. Coba lagi atau isi manual.');
}
