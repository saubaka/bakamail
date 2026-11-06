import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
  },
});
