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
    else if (entry.name.endsWith(".ts"))
      sources.set(path, await readFile(resolve(root, path), "utf8"));
  }
}
for (const directory of ["src", "shared", "client/src", "packages"])
  await collect(directory);
for (const [file, source] of sources) {
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
        file.startsWith("client/src/lib/")) &&
      target
    ) {
      check(
        !target.startsWith("client/src/app/"),
        "features and client helpers must not depend on the application composition",
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
  `Architecture boundaries passed for ${sources.size} TypeScript modules.`,
);
