-- Foto bukti transfer, 1:1 dengan peserta_sesi. Dihapus otomatis setelah 14 hari.
CREATE TABLE bukti_bayar (
  peserta_id TEXT PRIMARY KEY REFERENCES peserta_sesi(id),
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  diunggah_pada INTEGER NOT NULL
);

CREATE INDEX idx_bukti_waktu ON bukti_bayar(diunggah_pada);
