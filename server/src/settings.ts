import { Config, Context, Layer, Redacted, Schema } from "effect";
import {
  DatasetBudget,
  defaultDatasetBudget,
} from "../../shared/trip-dataset.js";

const text = (name: string, fallback = "") =>
  Config.String(name).pipe(Config.withDefault(fallback));
const concurrency = (name: string, fallback: number) =>
  Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), name).pipe(
    Config.withDefault(fallback),
  );
const config = Config.all({
  appName: text("DATABRICKS_APP_NAME"),
  host: Config.schema(
    Schema.String.check(
      Schema.makeFilter((host) => {
        try {
          const url = new URL(host.includes("://") ? host : `https://${host}`);
          return (
            (url.protocol === "https:" &&
              !url.username &&
              !url.password &&
              url.pathname === "/" &&
              !url.search &&
              !url.hash) ||
            "Expected an HTTPS workspace origin or hostname"
          );
        } catch {
          return "Expected an HTTPS workspace origin or hostname";
        }
      }),
    ),
    "DATABRICKS_HOST",
  ).pipe(
    Config.withDefault(""),
    Config.map((host) =>
      host && !host.includes("://") ? `https://${host}` : host,
    ),
  ),
  warehouseId: text("DATABRICKS_WAREHOUSE_ID"),
  tripSnapshotTable: Config.schema(
    Schema.String.check(
      Schema.makeFilter(
        (table) =>
          table === "" ||
          /^(?:[A-Za-z_][A-Za-z0-9_-]{0,127}\.){2}[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(
            table,
          ) ||
          "Expected a three-part Unity Catalog table identifier",
      ),
    ),
    "TRIP_SNAPSHOT_TABLE",
  ).pipe(Config.withDefault("")),
  warehouseConcurrency: concurrency("WAREHOUSE_MAX_CONCURRENCY", 4),
  explorerRowBudget: Config.schema(
    DatasetBudget.fields.rows,
    "EXPLORER_ROW_BUDGET",
  ).pipe(Config.withDefault(defaultDatasetBudget.rows)),
  explorerByteBudget: Config.schema(
    DatasetBudget.fields.bytes,
    "EXPLORER_BYTE_BUDGET",
  ).pipe(Config.withDefault(defaultDatasetBudget.bytes)),
  genieConcurrency: concurrency("GENIE_MAX_CONCURRENCY", 2),
  profile: text("DATABRICKS_CONFIG_PROFILE"),
  token: Config.Redacted("DATABRICKS_TOKEN").pipe(
    Config.withDefault(Redacted.make("")),
  ),
  clientId: text("DATABRICKS_CLIENT_ID"),
  clientSecret: Config.Redacted("DATABRICKS_CLIENT_SECRET").pipe(
    Config.withDefault(Redacted.make("")),
  ),
  genieSpaceId: text("GENIE_SPACE_ID"),
  pgHost: text("PGHOST"),
  pgPort: Config.Port("PGPORT").pipe(Config.withDefault(5432)),
  pgDatabase: text("PGDATABASE", "databricks_postgres"),
  pgUser: text("PGUSER"),
  pgPassword: Config.Redacted("PGPASSWORD").pipe(
    Config.withDefault(Redacted.make("")),
  ),
  lakebaseEndpoint: text("LAKEBASE_ENDPOINT"),
});
export class Settings extends Context.Service<
  Settings,
  Config.Success<typeof config>
>()("app/Settings") {
  static readonly layer = Layer.effect(Settings, config);
}
