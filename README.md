# LLM Pribadi

Chat dengan LLM dari penyedia mana pun (BYOK), mobile-first. Lihat PRD untuk detail.

## Menjalankan

1. Buat project gratis di [Neon](https://neon.tech), salin connection string ke `DATABASE_URL` di `.env.local`.
   (`ENCRYPTION_KEY` dan `SESSION_SECRET` sudah diisi acak.)
2. Buat tabel: `npx drizzle-kit push`
3. Jalankan: `npm run dev`, buka http://localhost:3000, buat password, tambah provider.

## Deploy ke Vercel

Isi tiga environment variable yang sama (`DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`) di Vercel.
Gunakan nilai `ENCRYPTION_KEY` yang sama bila ingin memakai database yang sama, atau key akan tak terbaca.

## Status

P0 selesai: auth password, provider + key terenkripsi (AES-256-GCM), daftar model, chat streaming,
ganti model di tengah percakapan, riwayat (rename/hapus/pin), pencarian dasar.
Belum: persona, pengaturan (tema/temperature), ekspor, PWA (P1).
