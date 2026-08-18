// Renders documentation.md to static public/documentation.html at build time —
// math (KaTeX) and code highlighting are baked into the HTML here instead of being
// parsed/typeset in the browser on every visit. Runs via the predev/prebuild npm
// lifecycle hooks (see package.json), so both `npm run dev` and `npm run build` always
// serve the current markdown.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "documentation.md");
const output = path.join(root, "public/documentation.html");

const markdown = await readFile(source, "utf8");

const file = await unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeHighlight)
  .use(rehypeStringify)
  .process(markdown);

await writeFile(output, String(file));
console.log(`Built ${path.relative(root, output)} from ${path.relative(root, source)}`);
