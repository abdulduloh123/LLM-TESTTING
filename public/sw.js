// Service worker minimal: hanya agar aplikasi bisa dipasang (PWA).
// Sengaja TIDAK menyimpan cache apa pun: semua halaman/API berisi data pribadi dan butuh sesi.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
