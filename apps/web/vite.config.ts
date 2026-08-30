import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget =
    process.env.API_PROXY_TARGET ??
    env.API_PROXY_TARGET ??
    "http://localhost:8010";
  return {
    plugins: [react()],
    build: { sourcemap: false, outDir: "dist" },
    test: { environment: "jsdom", globals: true },
    server: {
      watch: {
        usePolling:
          (process.env.CHOKIDAR_USEPOLLING ?? env.CHOKIDAR_USEPOLLING) ===
          "true",
      },
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true },
      },
    },
  };
});
