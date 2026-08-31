import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Tijdens lokaal ontwikkelen praat de dev-server met de container op 8083.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8083",
        changeOrigin: true,
      },
    },
  },
});
