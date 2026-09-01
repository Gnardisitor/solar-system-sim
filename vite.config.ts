import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { transform } from "lightningcss";

const root = dirname(fileURLToPath(import.meta.url));

// Inlines the render-blocking stylesheets into the built HTML so first paint needs a
// single request. Sources stay as separate .css files; dev keeps plain <link>s.
function inlineRenderBlockingCss(files: readonly string[]): Plugin {
  return {
    name: "inline-render-blocking-css",
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle || !ctx.filename.endsWith("index.html")) return html; // dev + about page: keep <link>s
      for (const file of files) {
        const { code } = transform({
          filename: file,
          code: Buffer.from(readFileSync(resolve(root, "public", file), "utf8")),
          minify: true,
        });
        // The CSS was written relative to public/css/; at page root, ../x becomes ./x.
        const css = code
          .toString()
          .replaceAll('url(../', 'url(./');
        const link = `<link rel="stylesheet" href="./${file}">`;
        if (!html.includes(link)) throw new Error(`No <link> found for ${file}`);
        html = html.replace(link, `<style>${css}</style>`);
      }
      return html;
    },
  };
}

export default defineConfig({
  plugins: [inlineRenderBlockingCss(["css/tokens.css", "css/interactive.css"])],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        about: "about.html"
      }
    }
  },
  base: '/solar-system-sim/'  // For GitHub Pages deployment
});
