import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";

const host = process.env.TAURI_DEV_HOST;
const isTauriDev = Boolean(host);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    sveltekit(),
    {
      name: "dev-proxy",
      configureServer(/** @type {import('vite').ViteDevServer} */ server) {
        server.middlewares.use("/api/takealot", async (/** @type {import('http').IncomingMessage} */ req, /** @type {import('http').ServerResponse} */ res) => {
          try {
            const incomingUrl =
              req.originalUrl || req.url || "";
            const url = new URL(incomingUrl, "http://localhost");
            let targetPath = url.pathname.replace(/^\/api\/takealot\/?/, "");
            targetPath = targetPath.replace(/^\/+/, "");
            if (!targetPath) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing API path" }));
              return;
            }
            const target = new URL(
              `https://api.takealot.com/rest/${targetPath}`
            );
            url.searchParams.forEach((value, key) => {
              target.searchParams.append(key, value);
            });
            const response = await fetch(target.toString(), {
              headers: {
                "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
                accept: req.headers.accept || "application/json",
              },
            });
            res.statusCode = response.status;
            const contentType = response.headers.get("content-type");
            if (contentType) {
              res.setHeader("Content-Type", contentType);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            res.end(buffer);
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: "Upstream fetch failed" }));
          }
        });

        server.middlewares.use("/api/image", async (/** @type {import('http').IncomingMessage} */ req, /** @type {import('http').ServerResponse} */ res) => {
          try {
            const url = new URL(req.url || "", "http://localhost");
            const targetUrl = url.searchParams.get("url");
            if (!targetUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing url" }));
              return;
            }
            const parsed = new URL(targetUrl);
            if (parsed.protocol !== "https:") {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Only https URLs are allowed" }));
              return;
            }
            const response = await fetch(parsed.toString(), {
              headers: {
                "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
              },
            });
            res.statusCode = response.status;
            const contentType = response.headers.get("content-type");
            if (contentType) {
              res.setHeader("Content-Type", contentType);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            res.end(buffer);
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: "Image fetch failed" }));
          }
        });
      },
    },
    SvelteKitPWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "tauri.svg"],
      manifest: {
        name: "Takealot API Desktop",
        short_name: "Takealot API",
        description: "Takealot API desktop client",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: isTauriDev
    ? {
        port: 1420,
        strictPort: true,
        host,
        hmr: {
          protocol: "ws",
          host,
          port: 1421,
        },
        watch: {
          // 3. tell Vite to ignore watching `src-tauri`
          ignored: ["**/src-tauri/**"],
        },
      }
    : {
        port: 5173,
        host: true,
        watch: {
          ignored: ["**/src-tauri/**"],
        },
      },
}));
