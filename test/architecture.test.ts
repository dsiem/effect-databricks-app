import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

for (const [name, file, source, allowed] of [
  [
    "browser shares API contracts",
    "client/src/api.ts",
    'import { Api } from "../../shared/api";',
    true,
  ],
  [
    "browser cannot import server implementations",
    "client/src/api.ts",
    'import { Settings } from "../../src/settings";',
    false,
  ],
  [
    "UI cannot take app types",
    "client/src/ui/button.ts",
    'import type { Model } from "../app/model";',
    false,
  ],
  [
    "contracts cannot import Node APIs",
    "shared/api.ts",
    'import { readFile } from "node:fs";',
    false,
  ],
  [
    "package cannot re-export app schemas",
    "packages/sql/src/index.ts",
    'export { Filters } from "../../../shared/domain";',
    false,
  ],
  [
    "browser dynamic imports obey boundaries",
    "client/src/api.ts",
    'const server = import("../../src/main");',
    false,
  ],
] as const) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), "blueprint-boundary-"));
    try {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
      const run = () =>
        execFileSync(
          process.execPath,
          [resolve("scripts/check-architecture.mjs"), root],
          { stdio: "pipe" },
        );
      if (allowed) assert.doesNotThrow(run);
      else assert.throws(run);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
