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

## Fitur

- Chat streaming dengan provider mana pun (OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, DeepSeek, Venice, kustom). Key disimpan terenkripsi (AES-256-GCM).
- Ganti model di tengah percakapan, favorit, riwayat (rename/hapus/pin), pencarian isi pesan.
- **Pengaturan** (`/settings`): tema, persona/system prompt (bisa banyak, ganti cepat dari menu model), temperature, batas token balasan, batas konteks, judul otomatis. Semuanya disimpan di tabel `settings` yang sudah ada, jadi **tidak perlu migrasi database**.
- Lampiran: gambar (diperkecil otomatis di perangkat) dan berkas teks/kode.
- Tampilan token per balasan, blok "proses berpikir" yang bisa dilipat, sorotan sintaks pada blok kode.
- Ekspor per percakapan (Markdown) dan semua percakapan (JSON).
- PWA: bisa dipasang ke layar utama HP ("Tambahkan ke layar utama").

## Stabilitas

- Pesan disimpan dengan upsert per pesan dalam satu batch (transaksi), bukan hapus-lalu-isi-ulang, sehingga riwayat tidak bisa setengah hilang.
- Klien hanya mengirim pesan terbaru; riwayat dibaca dari database (request kecil, aman dari batas 4,5 MB Vercel walau ada gambar).
- Riwayat yang terlalu panjang dipangkas otomatis dari pesan terlama sesuai batas konteks di Pengaturan.
- Pesan galat provider diterjemahkan (key ditolak, kuota habis, konteks terlalu panjang, model tak mendukung gambar, dll).
- Login: batas percobaan per IP dan global, catatan lama dibersihkan, pembuatan password pertama bersifat atomik.
- Opsional: isi env `SETUP_TOKEN` agar pembuatan password pertama butuh kode (mencegah orang lain mendahului setelah deploy). Bila tidak diisi, perilaku sama seperti sebelumnya.

## Pengembangan

```
npm run lint
npm run typecheck
npm test
npm run build
```

CI (GitHub Actions) menjalankan keempatnya pada setiap push dan pull request.
