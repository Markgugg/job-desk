import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// npm start serves dist/ from the Node server. During `npm run dev`, Vite
// proxies the API to that server on port 4400.
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") }
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true
  },
  server: {
    port: 5273,
    proxy: {
      "/api": { target: "http://127.0.0.1:4400", changeOrigin: true },
      "/resumes": { target: "http://127.0.0.1:4400", changeOrigin: true }
    }
  }
});
