import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";

const host = process.env.TAURI_DEV_HOST;
const hubApiTarget = process.env.VITE_HUB_API_URL || "https://api.manabrew.app";

// The release flow's authoritative version. `cargo xtask release` bumps this
// manifest plus the mirrors (package.json, src-tauri/tauri.conf.json,
// Cargo.toml) in the same release commit, then tags vX.Y.Z — so the manifest
// always matches the shipped release tag, even if package.json is hand-edited
// out of sync.
const appVersion = (
  JSON.parse(readFileSync(path.resolve(__dirname, "ops/manifest.json"), "utf-8")) as {
    packages: Record<string, string>;
  }
).packages["manabrew"];

const COEP = "require-corp";

function workbenchAiProxy(): Plugin {
  return {
    name: "workbench-ai-proxy",
    configureServer(server) {
      server.middlewares.use("/workbench-ai/chat/completions", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: { message: "Method not allowed." } }));
          return;
        }

        const targetBase = (process.env.WORKBENCH_AI_BASE_URL || "https://api.openai.com/v1")
          .trim()
          .replace(/\/+$/, "");
        const apiKey = (process.env.WORKBENCH_AI_API_KEY || "").trim();
        const configuredMode = (process.env.WORKBENCH_AI_API_MODE || "").trim().toLowerCase();
        const apiMode =
          configuredMode || (targetBase.includes("api.openai.com") ? "responses" : "chat");

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        try {
          const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            model?: string;
            messages?: Array<{ role?: string; content?: unknown }>;
            workbenchImportance?: "routine" | "strategic";
            [key: string]: unknown;
          };

          if (targetBase.includes("api.openai.com") && !apiKey) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: {
                  message:
                    "OpenAI API key is not configured. Start Workbench with scripts/start-workbench-ai.ps1.",
                },
              }),
            );
            return;
          }

          if (apiMode === "responses") {
            const upstream = await fetch(`${targetBase}/responses`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: requestBody.model,
                input: requestBody.messages ?? [],
                reasoning: {
                  effort: requestBody.workbenchImportance === "routine" ? "low" : "high",
                },
              }),
            });

            const payload = (await upstream.json().catch(() => ({}))) as {
              error?: { message?: string };
              output?: Array<{
                type?: string;
                content?: Array<{ type?: string; text?: string }>;
              }>;
              usage?: {
                input_tokens?: number;
                input_tokens_details?: {
                  cached_tokens?: number;
                  cache_write_tokens?: number;
                };
                output_tokens?: number;
                output_tokens_details?: {
                  reasoning_tokens?: number;
                };
                total_tokens?: number;
              };
            };

            if (!upstream.ok) {
              res.statusCode = upstream.status;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(payload));
              return;
            }

            const text = payload.output
              ?.flatMap((item) => item.content ?? [])
              .filter((part) => part.type === "output_text")
              .map((part) => part.text ?? "")
              .join("")
              .trim();

            if (!text) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: { message: "OpenAI Responses API returned no output text." },
                }),
              );
              return;
            }

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                choices: [{ message: { content: text } }],
                workbenchUsage: payload.usage
                  ? {
                      inputTokens: payload.usage.input_tokens ?? 0,
                      cachedInputTokens:
                        payload.usage.input_tokens_details?.cached_tokens ?? 0,
                      cacheWriteTokens:
                        payload.usage.input_tokens_details?.cache_write_tokens ?? 0,
                      outputTokens: payload.usage.output_tokens ?? 0,
                      reasoningTokens:
                        payload.usage.output_tokens_details?.reasoning_tokens ?? 0,
                      totalTokens:
                        payload.usage.total_tokens ??
                        (payload.usage.input_tokens ?? 0) +
                          (payload.usage.output_tokens ?? 0),
                    }
                  : null,
              }),
            );
            return;
          }

          const chatBody = { ...requestBody };
          delete chatBody.workbenchImportance;
          const upstream = await fetch(`${targetBase}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(chatBody),
          });

          const payload = (await upstream.json().catch(() => ({}))) as {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              prompt_tokens_details?: {
                cached_tokens?: number;
                cache_write_tokens?: number;
              };
              completion_tokens_details?: {
                reasoning_tokens?: number;
              };
            };
            [key: string]: unknown;
          };
          const usage = payload.usage;
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ...payload,
              ...(usage
                ? {
                    workbenchUsage: {
                      inputTokens: usage.prompt_tokens ?? 0,
                      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                      cacheWriteTokens:
                        usage.prompt_tokens_details?.cache_write_tokens ?? 0,
                      outputTokens: usage.completion_tokens ?? 0,
                      reasoningTokens:
                        usage.completion_tokens_details?.reasoning_tokens ?? 0,
                      totalTokens:
                        usage.total_tokens ??
                        (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
                    },
                  }
                : {}),
            }),
          );
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message:
                  error instanceof Error
                    ? `Workbench AI proxy failed: ${error.message}`
                    : "Workbench AI proxy failed.",
              },
            }),
          );
        }
      });
    },
  };
}

function crossOriginIsolation(): Plugin {
  return {
    name: "cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", COEP);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui(),
    tailwindcss(),
    Icons({
      compiler: "raw",
    }),
    crossOriginIsolation(),
    workbenchAiProxy(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The client shares the Forge seat and card-selection modules with the
      // published @manabrew/forge-wasm package rather than keeping a copy.
      "@forge-wasm": path.resolve(__dirname, "./packages/forge-wasm"),
    },
  },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      useFsEvents: false,
      usePolling: true,
      interval: 750,
      ignored: [
        "**/.logs/**",
        "**/forge/**",
        "**/forge-harness/**",
        "**/manabrew-rs/**",
        "**/node_modules/**",
        "**/parity_decks/**",
        "**/src-tauri/**",
        "**/target/**",
        "**/website/**",
      ],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": COEP,
    },
    proxy: {
      "/hub-api": {
        target: hubApiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hub-api/, ""),
      },
      "/spellbook-api": {
        target: "https://backend.commanderspellbook.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/spellbook-api/, ""),
      },
      "/cubecobra-download": {
        target: "https://cubecobra.com",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["set-cookie"];
          });
        },
        rewrite: (p) => p.replace(/^\/cubecobra-download/, ""),
      },
      "/scryfall-symbols": {
        target: "https://svgs.scryfall.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-symbols/, "/card-symbols"),
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@/wasm/wasm", "ironsmith-wasm"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "esnext",
  },
});
