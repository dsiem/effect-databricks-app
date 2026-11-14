import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const lock = JSON.parse(
  await readFile(new URL("package-lock.json", root), "utf8"),
);
const legacy =
  /^(?:react(?:$|[-/])|react-dom(?:$|\/)|recharts$|lucide-react$|radix-ui$|@radix-ui\/react-|@tanstack\/react-|@vitejs\/plugin-react$|@types\/react(?:$|-))/;
assert.ok(manifest.dependencies.foldkit, "Foldkit must be a direct dependency");
for (const name of Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})) {
  assert.ok(!legacy.test(name), `Legacy frontend dependency: ${name}`);
}
for (const path of Object.keys(lock.packages)) {
  const name = path.split("node_modules/").at(-1);
  assert.ok(!legacy.test(name), `Legacy transitive dependency: ${path}`);
}
async function audit(directory) {
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) {
      files += await audit(url);
      continue;
    }
    assert.ok(
      !/\.[jt]sx$/.test(entry.name),
      `JSX source remains: ${url.pathname}`,
    );
    if (!entry.name.endsWith(".ts")) continue;
    const source = await readFile(url, "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.ok(
        !legacy.test(match[1]),
        `Legacy import in ${url.pathname}: ${match[1]}`,
      );
    }
    files++;
  }
  return files;
}
const files = await audit(new URL("client/src/", root));
for (const entry of await readdir(new URL("e2e/", root))) {
  if (!entry.endsWith(".ts")) continue;
  const source = await readFile(new URL(`e2e/${entry}`, root), "utf8");
  assert.ok(
    !source.includes(".recharts-"),
    `Legacy chart selector in e2e/${entry}`,
  );
}
const html = await readFile(new URL("client/index.html", root), "utf8");
assert.match(html, /src="\/src\/main\.ts"/);
console.log(
  `Foldkit migration audit passed: ${files} TypeScript modules; no React dependencies, imports, or JSX.`,
);
