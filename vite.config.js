import { defineConfig } from "vite";

// `base` is read from VITE_BASE so the GitHub Pages workflow can inject the
// repo subpath (e.g. "/PDF-Seperator/") at build time, while local dev keeps
// using "./". Absolute paths matter on Pages because PDF.js's bundled worker
// URL must resolve correctly regardless of where the page is loaded from.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  server: { port: 5173, open: true },
  build: { outDir: "dist", emptyOutDir: true },
});
