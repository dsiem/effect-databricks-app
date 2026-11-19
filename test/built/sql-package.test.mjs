import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { Effect, Redacted } from "effect";

// Import and execute the actual distribution, outside the source tree. This
// catches missing runtime files and bad package exports without a registry.
const directory = mkdtempSync(join(tmpdir(), "sql-warehouse-package-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "@dsiem/sql-warehouse",
        "--pack-destination",
        directory,
        "--cache",
        join(directory, "cache"),
        "--json",
        "--silent",
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(packed.length, 1);
  execFileSync("tar", [
    "-xzf",
    join(directory, packed[0].filename),
    "-C",
    directory,
  ]);
  symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
  const consumer = join(directory, "package/consumer.mjs");
  writeFileSync(consumer, 'export * from "@dsiem/sql-warehouse";\n');
  const exports = await import(pathToFileURL(consumer));
  const ipc = tableToIPC(
    tableFromArrays({ id: BigInt64Array.of(9007199254740993n) }),
    "stream",
  );
  const table = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* exports.DatabricksClient.DatabricksClient;
      return yield* sql.arrow(sql`SELECT ${9007199254740993n} AS id`);
    }).pipe(
      Effect.provide(
        exports.DatabricksClient.layer({
          host: "https://workspace.example",
          warehouseId: "warehouse",
          accessToken: Effect.succeed(Redacted.make("test-token")),
          fetch: async (input) =>
            new URL(String(input)).hostname === "storage.example"
              ? new Response(ipc)
              : Response.json({
                  statement_id: "packed-statement",
                  status: { state: "SUCCEEDED" },
                  manifest: { format: "ARROW_STREAM", total_chunk_count: 1 },
                  result: {
                    external_links: [
                      {
                        chunk_index: 0,
                        external_link: "https://storage.example/0",
                      },
                    ],
                  },
                }),
        }),
      ),
    ),
  );
  assert.equal(table.getChild("id").get(0), 9007199254740993n);
  console.log(
    "Packed Databricks SQL adapter imported and executed an Arrow query",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
