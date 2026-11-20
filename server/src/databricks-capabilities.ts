import { Config, Effect, type Layer, Schema } from "effect";

function capability<const K extends string, const P extends string, A>(
  kind: K,
  permission: P,
  alias: string,
  env: string,
  read: (key: string) => Config.Config<A>,
) {
  const binding = { kind, permission, alias, env };
  return {
    binding,
    config: read(env),
    client:
      <S, E, R>(layer: Layer.Layer<S, E, R>) =>
      (attach: (request: typeof binding) => Effect.Effect<void>) =>
        Effect.as(attach(binding), layer),
  };
}

const text = (key: string) => Config.String(key).pipe(Config.withDefault(""));

export const queryWarehouse = capability(
  "sql_warehouse",
  "CAN_USE",
  "lakehouse",
  "DATABRICKS_WAREHOUSE_ID",
  text,
);
export const runAnalysisJob = capability(
  "job",
  "CAN_MANAGE_RUN",
  "route-reliability",
  "ANALYSIS_JOB_ID",
  (key) =>
    Config.schema(
      Schema.Union([
        Schema.Literal(""),
        Schema.NumberFromString.check(
          Schema.isInt(),
          Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ]),
      key,
    ).pipe(Config.withDefault("")),
);
export const askGenie = capability(
  "genie_space",
  "CAN_RUN",
  "genie",
  "GENIE_SPACE_ID",
  text,
);
export const connectLakebase = capability(
  "postgres",
  "CAN_CONNECT_AND_CREATE",
  "lakebase",
  "LAKEBASE_ENDPOINT",
  text,
);

export type DatabricksCapability =
  | typeof queryWarehouse.binding
  | typeof runAnalysisJob.binding
  | typeof askGenie.binding
  | typeof connectLakebase.binding;
