import assert from "node:assert/strict";
import { tableFromArrays } from "apache-arrow";
import { DatabricksClient } from "@dsiem/sql-warehouse";
import { Effect, Layer } from "effect";
import { AnalysisRuns } from "../src/analysis-runs.js";
import { workbenchServices } from "../src/databricks-services.js";
import { Genie } from "../src/genie.js";
import { Lakebase } from "../src/lakebase.js";
import { warehouseFetch } from "./warehouse-fixture.js";

const warehouse = warehouseFetch(async () => tableFromArrays({ answer: [42] }));
const observed: string[] = [];
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === "https://results.invalid") return warehouse(request);
  assert.equal(url.origin, "https://workspace.invalid");
  assert.equal(request.headers.get("authorization"), "Bearer runtime-pat");
  if (request.method === "POST" && url.pathname === "/api/2.0/sql/statements") {
    assert.partialDeepStrictEqual(await request.clone().json(), {
      statement: "SELECT 42 AS answer",
      warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
    });
    observed.push("warehouse");
    return warehouse(request);
  }
  if (request.method === "GET" && url.pathname === "/api/2.2/jobs/runs/list") {
    assert.equal(url.searchParams.get("job_id"), process.env.ANALYSIS_JOB_ID);
    observed.push("job");
    return Response.json({ runs: [] });
  }
  if (
    request.method === "POST" &&
    url.pathname ===
      `/api/2.0/genie/spaces/${process.env.GENIE_SPACE_ID}/start-conversation`
  ) {
    observed.push("genie");
    return Response.json({
      conversation_id: "conversation",
      message: { message_id: "message", conversation_id: "conversation" },
    });
  }
  if (
    request.method === "GET" &&
    url.pathname === `/api/2.0/postgres/${process.env.LAKEBASE_ENDPOINT}`
  ) {
    observed.push("lakebase");
    return Response.json({ status: { hosts: { host: "postgres.invalid" } } });
  }
  throw new Error(`Unexpected runtime request: ${request.method} ${url.href}`);
};

await Effect.runPromise(
  Effect.gen(function* () {
    const sql = yield* DatabricksClient.DatabricksClient;
    assert.deepEqual(yield* sql`SELECT 42 AS answer`, [{ answer: 42 }]);
    const jobs = yield* AnalysisRuns;
    assert.deepEqual(yield* jobs.list, []);
    const genie = yield* Genie;
    assert.deepEqual(yield* genie.submit({ content: "Count trips" }), {
      conversationId: "conversation",
      messageId: "message",
    });
    const lakebase = yield* Lakebase;
    yield* lakebase.use(() => Effect.void);
  }).pipe(Effect.provide(Layer.unwrap(workbenchServices()))),
);
assert.deepEqual(observed, ["warehouse", "job", "genie", "lakebase"]);
