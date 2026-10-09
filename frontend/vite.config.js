import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        passenger: fileURLToPath(new URL("./index.html", import.meta.url)),
        staff: fileURLToPath(new URL("./staff/index.html", import.meta.url)),
        kiosk: fileURLToPath(new URL("./kiosk/index.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
