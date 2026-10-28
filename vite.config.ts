import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_PORT = "3000";

export default defineConfig(({ mode }) => {
  // The dev server is spawned by `bun run dev`, which does not forward .env to it.
  const environment = loadEnv(mode, process.cwd(), "");
  return {
    server: { port: Number(environment["PORT"] ?? DEFAULT_PORT), strictPort: true },
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart({ srcDirectory: "src/web" }), viteReact()],
  };
});
