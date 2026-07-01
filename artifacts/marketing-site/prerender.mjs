// Build-time prerender: renders each public marketing route to a standalone
// static HTML file with route-correct <head> metadata + structured data, so
// non-JavaScript crawlers receive unique, accurate HTML per URL.
//
// Runs after `vite build` (client) and `vite build --ssr` (server bundle).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const distPublic = resolve(rootDir, "dist/public");
const serverEntry = pathToFileURL(
  resolve(rootDir, "dist/server/entry-server.js"),
).href;

const { render, routeMeta, renderHead } = await import(serverEntry);

const template = readFileSync(resolve(distPublic, "index.html"), "utf-8");

if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) {
  throw new Error(
    "index.html template is missing <!--app-head--> or <!--app-html--> placeholders",
  );
}

for (const meta of routeMeta) {
  const appHtml = render(meta.path);
  const head = renderHead(meta);
  const html = template
    .replace("<!--app-head-->", head)
    .replace("<!--app-html-->", appHtml);

  const fileName =
    meta.path === "/" ? "index.html" : `${meta.path.replace(/^\//, "")}.html`;
  writeFileSync(resolve(distPublic, fileName), html);
  console.log(`prerendered ${meta.path} -> ${fileName}`);
}
