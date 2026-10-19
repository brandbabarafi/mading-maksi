// Server statis kecil untuk mencoba folder public/ di komputer sendiri: `npm run dev`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const AKAR = resolve(import.meta.dirname, '..', 'public');
const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const PORT = Number(process.env.PORT) || 8787;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://lokal').pathname);
  const file = resolve(AKAR, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  if (!file.startsWith(AKAR + sep)) return res.writeHead(403).end();
  try {
    const isi = await readFile(file);
    res.writeHead(200, { 'content-type': TIPE[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(isi);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Mading Maksi lokal: http://localhost:${PORT}/?demo  (mode demo, data di browser)`);
  console.log(`Pakai data GitHub asli: http://localhost:${PORT}/`);
});
