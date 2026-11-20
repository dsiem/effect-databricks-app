import { readFile } from "node:fs/promises";
import { localState, Stack, Stage } from "alchemy";
import { Config, Effect, Layer, Schema } from "effect";
import { workbenchServices } from "../../server/src/databricks-services.js";
import { App, appProvider, attachDatabricks } from "./app.ts";
import {
  WorkspaceFile,
  fileProvider,
  SqlJob,
  jobProvider,
} from "./databricks.ts";

const identifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/),
);

export default Stack(
  "TaxiWorkbench",
  {
    providers: Layer.mergeAll(fileProvider, jobProvider, appProvider),
    state: localState(),
  },
  Effect.gen(function* () {
    const host = yield* Config.NonEmptyString("DATABRICKS_HOST");
    const directory = yield* Config.schema(
      Schema.String.check(Schema.isPattern(/^\/Workspace\/.+/)),
      "DATABRICKS_WORKSPACE_DIR",
    );
    const warehouse = yield* Config.NonEmptyString("DATABRICKS_WAREHOUSE_ID");
    const catalog = yield* Config.schema(identifier, "DATA_CATALOG");
    const schema = yield* Config.schema(identifier, "DATA_SCHEMA");
    const genieId = yield* Config.NonEmptyString("DATABRICKS_GENIE_SPACE_ID");
    const genieName = yield* Config.NonEmptyString(
      "DATABRICKS_GENIE_SPACE_NAME",
    );
    const branch = yield* Config.NonEmptyString("DATABRICKS_POSTGRES_BRANCH");
    const stage = yield* Stage;
    const sql = yield* WorkspaceFile("RouteSql", {
      host,
      directory,
      filename: "route-reliability.sql",
      content: yield* Effect.promise(() =>
        readFile(
          new URL("../../jobs/route-reliability.sql", import.meta.url),
          "utf8",
        ),
      ),
    });
    const table = (name: string) =>
      [catalog, schema, name].map((part) => "`" + part + "`").join(".");
    const job = yield* SqlJob("AnalysisJob", {
      host,
      settings: {
        name: "alchemy-taxi-" + stage + "-route-reliability",
        description:
          "Compare p90 trip durations by pickup ZIP, drop-off ZIP, and time of day across two weeks.",
        max_concurrent_runs: 1,
        queue: { enabled: true },
        parameters: [
          { name: "baseline_week", default: "2016-01-04" },
          { name: "comparison_week", default: "2016-01-11" },
          { name: "minimum_trips", default: "50" },
          { name: "requested_by", default: "" },
        ],
        tasks: [
          {
            task_key: "compare_routes",
            sql_task: {
              warehouse_id: warehouse,
              file: { path: sql.path, source: "WORKSPACE" },
              parameters: {
                analysis_run_id: "{{job.run_id}}",
                snapshot_table: table("trips"),
                results_table: table("route_reliability_runs"),
              },
            },
          },
        ],
      },
    });
    const app = yield* App("TaxiApp", {
      host,
      command: ["node", "dist/server/src/main.js"],
      env: {
        TRIP_SNAPSHOT_TABLE: [catalog, schema, "trips"].join("."),
        ANALYSIS_RESULTS_TABLE: [
          catalog,
          schema,
          "route_reliability_runs",
        ].join("."),
        PGDATABASE: "databricks_postgres",
      },
    });

    yield* workbenchServices(
      attachDatabricks(app, {
        sql_warehouse: { id: warehouse },
        job: { id: job.jobId },
        genie_space: { name: genieName, space_id: genieId },
        postgres: {
          branch,
          database: branch + "/databases/databricks-postgres",
        },
      }),
    );
    return {
      workspaceHost: host,
      appName: app.name,
      jobId: job.jobId,
      sqlPath: sql.path,
      deploymentConfig: app.deploymentConfig,
    };
  }),
);
