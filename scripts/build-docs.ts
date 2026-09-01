// Renders documentation.md and inlines the result into about.html between the
// docs:content markers, so the page ships its full content with no runtime fetch.
// Runs via the predev/prebuild hooks (see package.json).
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
const target = path.join(root, "about.html");

// about.html carries these markers around the generated block; everything between
// them is replaced on each run, so the script stays idempotent.
const START_MARKER = "<!-- docs:content:start -->";
const END_MARKER = "<!-- docs:content:end -->";

const markdown = await readFile(source, "utf8");

const file = await unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeHighlight)
  .use(rehypeStringify)
  .process(markdown);

const rendered = String(file).trim();

const page = await readFile(target, "utf8");
const startIndex = page.indexOf(START_MARKER);
const endIndex = page.indexOf(END_MARKER);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error(`${path.relative(root, target)} is missing the ${START_MARKER} / ${END_MARKER} markers`);
}

await writeFile(
  target,
  page.slice(0, startIndex + START_MARKER.length) + "\n" + rendered + "\n" + page.slice(endIndex),
);
console.log(`Inlined ${path.relative(root, source)} into ${path.relative(root, target)}`);
