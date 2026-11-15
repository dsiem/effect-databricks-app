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
    "feature reducers cannot import the application model",
    "client/src/features/trips/update.ts",
    'import type { Model } from "../../app/model";',
    false,
  ],
  [
    "feature commands cannot import application messages",
    "client/src/features/trips/commands.ts",
    'import { Message } from "../../app/message";',
    false,
  ],
  [
    "client helpers cannot depend on application messages",
    "client/src/lib/result.ts",
    'import { Message } from "../app/message";',
    false,
  ],
  [
    "application composes feature contracts",
    "client/src/app/model.ts",
    'import { Model } from "../features/trips/model";',
    true,
  ],
  [
    "a feature owns its model and messages",
    "client/src/features/trips/update.ts",
    'import type { Model } from "./model";',
    true,
  ],
  [
    "features may use shared domain helpers",
    "client/src/features/trips/view.ts",
    'import { ask } from "../../domain/analysis";',
    true,
  ],
  [
    "feature views cannot import a sibling's messages",
    "client/src/features/trips/view-messages.ts",
    'import { messages } from "../genie/messages";',
    false,
  ],
  [
    "feature types cannot depend on a sibling model",
    "client/src/features/map/view-model.ts",
    'import type { Model } from "../overview/model";',
    false,
  ],
  [
    "aliases cannot bypass sibling feature boundaries",
    "client/src/features/map/view.ts",
    'export { view } from "@/features/overview/view";',
    false,
  ],
  [
    "dynamic imports cannot bypass sibling feature boundaries",
    "client/src/features/map/view.ts",
    'const view = import("../overview/view");',
    false,
  ],
  [
    "shared domain helpers cannot hide a feature dependency",
    "client/src/domain/analysis.ts",
    'export { messages } from "../features/genie/messages";',
    false,
  ],
  [
    "shared client helpers cannot hide a feature dependency",
    "client/src/lib/request-state.ts",
    'import type { Model } from "../features/overview/model";',
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
