import assert from "node:assert/strict";
import { test } from "node:test";
import { tableFromArrays } from "apache-arrow";
import { ConfigProvider, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Analytics } from "../src/analytics.js";
import { Genie } from "../src/genie.js";
import { Lakebase } from "../src/lakebase.js";
import { Routes } from "../src/routes.js";
import { SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { TripComments } from "../src/trip-comments.js";
import { Workspace } from "../src/workspace.js";
import { warehouseFetch } from "./warehouse-fixture.js";

test("analysis runs recover submission, scope history and results, and read an empty report", async (t) => {
  const input = {
    baselineWeek: "2016-01-04",
    comparisonWeek: "2016-01-11",
    minimumTrips: 50,
  };
  const jobParameters = {
    baseline_week: input.baselineWeek,
    comparison_week: input.comparisonWeek,
    minimum_trips: String(input.minimumTrips),
  };
  const report = { input, rows: [] };
  const submissions: unknown[] = [];
  let state = "QUEUED";
  let reads = 0;
  const sql = warehouseFetch(async (statement, _signal, parameters) => {
    reads++;
    assert.match(
      statement,
      /`custom`\.`taxi-schema`\.`route_reliability_runs`/,
    );
    assert.match(statement, /WHERE run_id = CAST\(:\w+ AS BIGINT\)/);
    assert.deepEqual(
      parameters.map(({ value }) => value),
      ["123"],
    );
    return tableFromArrays({ report_json: [JSON.stringify(report)] });
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/2.2/jobs/")) return sql(request);
    const run = { job_id: 456, run_id: 123, status: { state } };
    switch (url.pathname) {
      case "/api/2.2/jobs/run-now":
        submissions.push(await request.json());
        return submissions.length === 1
          ? Response.json({}, { status: 503 })
          : Response.json({ run_id: run.run_id });
      case "/api/2.2/jobs/runs/list":
        assert.equal(url.searchParams.get("job_id"), "456");
        return Response.json({
          runs: [run, { ...run, job_id: 789, run_id: 124 }],
        });
      case "/api/2.2/jobs/runs/get":
        return Response.json({
          ...run,
          ...(url.searchParams.get("run_id") === "124"
            ? { job_id: 789, run_id: 124 }
            : {}),
          status:
            state === "TERMINATED"
              ? { state, termination_details: { code: "SUCCESS" } }
              : { state },
          job_parameters: Object.entries(jobParameters).map(
            ([name, value]) => ({ name, value }),
          ),
        });
      default:
        throw new Error(`Unexpected request to ${url.pathname}`);
    }
  };
  const services = Layer.mergeAll(
    Analytics.layer,
    Genie.layer,
    SavedViews.layer,
    TripComments.layer,
  ).pipe(
    Layer.provideMerge(Lakebase.layer),
    Layer.provideMerge(Workspace.layer),
    Layer.provideMerge(Settings.layer),
    Layer.provide(
      Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          DATABRICKS_HOST: "https://workspace.invalid",
          DATABRICKS_TOKEN: "fixture",
          DATABRICKS_WAREHOUSE_ID: "warehouse",
          TRIP_SNAPSHOT_TABLE: "custom.taxi-schema.trips_2016",
          ANALYSIS_JOB_ID: "456",
          ANALYSIS_RESULTS_TABLE: "custom.taxi-schema.route_reliability_runs",
        }),
      ),
    ),
  );
  const app = HttpRouter.toWebHandler(
    Routes.pipe(
      Layer.provide(services),
      Layer.provideMerge(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
  t.after(app.dispose);
  const api = (path = "", init?: RequestInit) =>
    app.handler(new Request(`http://localhost/api/analysis-runs${path}`, init));
  const submit = (analysis = input) =>
    api("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: analysis,
        requestId: "52545413-6df3-4669-9e53-200b323b4001",
      }),
    });

  assert.equal(
    (await submit({ ...input, comparisonWeek: "2016-02-30" })).status,
    400,
  );
  assert.equal(submissions.length, 0);
  assert.equal((await submit()).status, 502);
  const accepted = await submit();
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { id: 123 });
  assert.deepEqual(submissions[0], submissions[1]);
  const [submitted] = submissions;
  assert.ok(
    submitted &&
      typeof submitted === "object" &&
      "idempotency_token" in submitted,
  );
  assert.ok(typeof submitted.idempotency_token === "string");
  assert.match(submitted.idempotency_token, /^[a-f0-9]{64}$/);
  assert.deepEqual(submissions[1], {
    job_id: 456,
    job_parameters: jobParameters,
    idempotency_token: submitted.idempotency_token,
  });
  assert.deepEqual(await (await api()).json(), [
    { id: 123, state: "queued", startedAt: null, endedAt: null },
  ]);
  assert.deepEqual(await (await api("/123")).json(), {
    id: 123,
    state: "queued",
    startedAt: null,
    endedAt: null,
    input,
    reason: null,
  });
  assert.equal((await api("/123/result")).status, 409);
  assert.equal((await api("/124")).status, 404);
  assert.equal((await api("/124/result")).status, 404);
  assert.equal(reads, 0);

  state = "TERMINATED";
  const result = await api("/123/result");
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), report);
  assert.equal(reads, 1);
});
