CREATE TABLE anggota (
  id INTEGER PRIMARY KEY,
  nama_panggilan TEXT NOT NULL UNIQUE COLLATE NOCASE,
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sesi_maksi (
  id TEXT PRIMARY KEY,
  penalang_id INTEGER NOT NULL REFERENCES anggota(id),
  resto TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'terbuka' CHECK (status IN ('terbuka', 'lunas', 'batal')),
  dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE biaya_sesi (
  id INTEGER PRIMARY KEY,
  sesi_id TEXT NOT NULL REFERENCES sesi_maksi(id),
  nama_biaya TEXT NOT NULL,
  nominal INTEGER NOT NULL CHECK (nominal >= 0),
  cara_bagi TEXT NOT NULL CHECK (cara_bagi IN ('rata', 'sebanding')),
  potongan INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE item_pesanan (
  id TEXT PRIMARY KEY,
  sesi_id TEXT NOT NULL REFERENCES sesi_maksi(id),
  nama_item TEXT NOT NULL,
  harga_satuan INTEGER NOT NULL CHECK (harga_satuan >= 0),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  sumber TEXT NOT NULL DEFAULT 'manual' CHECK (sumber IN ('manual', 'ai'))
);

CREATE TABLE peserta_sesi (
  id TEXT PRIMARY KEY,
  sesi_id TEXT NOT NULL REFERENCES sesi_maksi(id),
  anggota_id INTEGER NOT NULL REFERENCES anggota(id),
  total_tagihan INTEGER NOT NULL,
  status_bayar TEXT NOT NULL DEFAULT 'belum' CHECK (status_bayar IN ('belum', 'lunas')),
  lunas_pada TEXT,
  UNIQUE (sesi_id, anggota_id)
);

CREATE TABLE pembagian_item (
  id INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES item_pesanan(id),
  peserta_id TEXT NOT NULL REFERENCES peserta_sesi(id),
  porsi REAL NOT NULL DEFAULT 1 CHECK (porsi > 0)
);

-- Pembatas percobaan kode ruangan yang salah, per IP.
CREATE TABLE gagal_kode (
  ip TEXT NOT NULL,
  waktu INTEGER NOT NULL
);

CREATE INDEX idx_sesi_tanggal ON sesi_maksi(tanggal);
CREATE INDEX idx_peserta_sesi ON peserta_sesi(sesi_id);
CREATE INDEX idx_item_sesi ON item_pesanan(sesi_id);
CREATE INDEX idx_biaya_sesi ON biaya_sesi(sesi_id);
CREATE INDEX idx_gagal_kode ON gagal_kode(ip, waktu);
