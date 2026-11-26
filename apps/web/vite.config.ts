import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// The public REST API sends no CORS headers, so the browser reaches it through
// the dev (and preview) server: /lcd/* is forwarded to QORE_REST_PROXY_TARGET.
// In production, serve the app behind a proxy that does the same, or set
// VITE_QORE_REST_URL to an endpoint that allows your origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.QORE_REST_PROXY_TARGET || "http://localhost:1317";
  const proxy = {
    "/lcd": { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/lcd/, "") },
  };
  return {
    plugins: [react()],
    // Use the engine straight from source so the browser and server run identical code.
    resolve: {
      alias: {
        "@tracerun/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)),
      },
    },
    server: { port: 5173, proxy },
    preview: { proxy },
  };
});
