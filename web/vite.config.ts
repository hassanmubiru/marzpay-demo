import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA is served by the StreetJS backend under "/app", so asset URLs must be
// prefixed accordingly. In dev, Vite proxies /api to the backend on :3000.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
