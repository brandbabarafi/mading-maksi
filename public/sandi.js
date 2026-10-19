// Enkripsi data rahasia (rincian menu, foto bukti) dan format kode ruangan.
// Kode ruangan = "MM1." + base64url(JSON { t: token GitHub, k: kunci AES, g: kunci Gemini, q: kunci Groq }).

export function keB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const dariB64 = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));

const kode = new TextEncoder();
const urai = new TextDecoder();

export const kunciBaru = () => keB64(crypto.getRandomValues(new Uint8Array(32)));

const impor = (b64) => crypto.subtle.importKey('raw', dariB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

// Hasil: 12 byte IV lalu ciphertext AES-GCM.
export async function enkripsi(kunci, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const isi = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kunci, bytes));
  const hasil = new Uint8Array(12 + isi.length);
  hasil.set(iv);
  hasil.set(isi, 12);
  return hasil;
}

export async function dekripsi(kunci, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, kunci, bytes.subarray(12)));
}

export const enkripsiJson = async (kunci, nilai) => keB64(await enkripsi(kunci, kode.encode(JSON.stringify(nilai))));
export const dekripsiJson = async (kunci, b64) => JSON.parse(urai.decode(await dekripsi(kunci, dariB64(b64))));

export function buatKode({ token, kunciB64, gemini = '', groq = '' }) {
  const isi = keB64(kode.encode(JSON.stringify({ t: token, k: kunciB64, g: gemini || undefined, q: groq || undefined })));
  return 'MM1.' + isi.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function bukaKode(teks) {
  const t = String(teks ?? '').trim();
  if (!t.startsWith('MM1.')) throw new Error('Format kode ruangan tidak dikenal');
  const j = JSON.parse(urai.decode(dariB64(t.slice(4).replace(/-/g, '+').replace(/_/g, '/'))));
  if (typeof j.t !== 'string' || j.t.length < 10 || typeof j.k !== 'string' || dariB64(j.k).length !== 32) {
    throw new Error('Isi kode ruangan tidak lengkap');
  }
  return { token: j.t, kunciB64: j.k, kunci: await impor(j.k), gemini: j.g ?? '', groq: j.q ?? '' };
}
