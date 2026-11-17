import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)),
);
const sources = new Map();
async function collect(directory) {
  let entries;
  try {
    entries = await readdir(resolve(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory() && !["dist", "node_modules"].includes(entry.name))
      await collect(path);
    else if (/\.(ts|css)$/.test(entry.name))
      sources.set(path, await readFile(resolve(root, path), "utf8"));
  }
}
for (const directory of ["src", "shared", "client/src", "packages"])
  await collect(directory);
for (const [file, source] of sources) {
  if (file.endsWith(".css")) {
    // Styles follow the same ownership as the views. Only the application
    // entry point composes shell and feature styles; UI can be copied alone.
    const imports = source.matchAll(
      /@(?:import|reference)\s+(?:["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\))/g,
    );
    for (const [, quoted, url] of imports) {
      const specifier = quoted ?? url;
      const target = specifier.startsWith(".")
        ? relative(root, resolve(root, dirname(file), specifier))
        : specifier.startsWith("@/")
          ? `client/src/${specifier.slice(2)}`
          : null;
      const owner = file.startsWith("client/src/features/")
        ? file.split("/").slice(0, 4).join("/")
        : dirname(file);
      assert.ok(
        file === "client/src/styles.css" ||
          (file.startsWith("client/src/ui/")
            ? target?.startsWith("client/src/ui/")
            : target === null ||
              target.startsWith(`${owner}/`) ||
              target.startsWith("client/src/ui/")),
        `${file}: ${specifier}: styles must stay within their owner or depend on reusable UI; compose features in client/src/styles.css`,
      );
    }
    continue;
  }
  if (/^(src|shared|client\/src)\//.test(file)) {
    // Keep the feature vocabulary consistent across contracts and implementations.
    assert.doesNotMatch(
      source,
      /\b(?:[A-Za-z]*Notes?|notes?(?:[A-Z]\w*|_[a-z]\w*)?|notebook)\b/,
      `${file}: use SavedView/savedViews and saved-view routes`,
    );
  }
  // Includes type imports, re-exports and literal dynamic/side-effect imports.
  const specifiers = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g,
  );
  for (const [, specifier] of specifiers) {
    const target = specifier.startsWith(".")
      ? relative(root, resolve(root, dirname(file), specifier))
      : specifier.startsWith("@/")
        ? `client/src/${specifier.slice(2)}`
        : null;
    const check = (condition, rule) =>
      assert.ok(condition, `${file}: ${specifier}: ${rule}`);
    if (file.startsWith("shared/")) {
      check(
        target
          ? target.startsWith("shared/")
          : specifier === "effect" || specifier.startsWith("effect/"),
        "shared contracts must be browser-safe and independent of application code",
      );
    }
    if (file.startsWith("client/")) {
      check(
        target
          ? target.startsWith("client/") || target.startsWith("shared/")
          : !specifier.startsWith("node:") &&
              specifier !== "effect-sql-databricks" &&
              !specifier.startsWith("@effect/platform-node"),
        "browser code may import only client code and shared contracts",
      );
    }
    if (
      (file.startsWith("client/src/features/") ||
        file.startsWith("client/src/lib/") ||
        file.startsWith("client/src/domain/")) &&
      target
    ) {
      check(
        !target.startsWith("client/src/app/"),
        "features and client helpers must not depend on the application composition",
      );
    }
    if (
      file.startsWith("client/src/features/") &&
      target?.startsWith("client/src/features/")
    ) {
      check(
        file.split("/")[3] === target.split("/")[3],
        "features must not import sibling features; compose their contracts in app/ or share domain helpers",
      );
    }
    if (
      (file.startsWith("client/src/lib/") ||
        file.startsWith("client/src/domain/")) &&
      target
    ) {
      check(
        !target.startsWith("client/src/features/"),
        "shared helpers must not depend on feature implementations",
      );
    }
    if (file.startsWith("client/src/ui/") && target) {
      check(
        target.startsWith("client/src/ui/") ||
          target === "client/src/lib/format",
        "generic UI must not depend on app state, features or domain schemas",
      );
    }
    if (file.startsWith("src/") && target)
      check(
        !target.startsWith("client/"),
        "server code must not depend on the browser",
      );
    if (file.startsWith("packages/") && target) {
      check(
        target.startsWith(`${file.split("/").slice(0, 2).join("/")}/`),
        "reusable packages must not depend on application code",
      );
    }
  }
}
console.log(
  `Architecture boundaries passed for ${sources.size} TypeScript and CSS files.`,
);
