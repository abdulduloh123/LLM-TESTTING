import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Pemeriksaan cepat: halaman tanpa cookie sesi diarahkan ke /login.
// Verifikasi sesungguhnya dilakukan di setiap Route Handler (guard()).
export function proxy(req: NextRequest) {
  if (!req.cookies.get("session")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icons/|icon.*|.*\\.(?:png|svg|jpg|ico|webp)$).*)",
  ],
};
