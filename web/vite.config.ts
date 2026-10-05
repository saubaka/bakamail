import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    proxy: {
      // 开发时把 /api 转发给本地 BFF；生产由 BFF 直接托管 dist
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    // Local BFF serves dist while tabs are open. Keep hashed chunks for those tabs;
    // deleting them would break lazy SPA routes and require a document reload.
    emptyOutDir: false,
    sourcemap: false,
  },
});
