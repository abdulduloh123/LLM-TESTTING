import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LLM Pribadi",
    short_name: "LLM Pribadi",
    description: "Chat dengan LLM dari penyedia mana pun, pakai key sendiri.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0e",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
