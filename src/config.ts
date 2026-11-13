import { Config, Schema } from "effect";

export const ServerConfig = Config.all({
  // Port 0 lets the OS select an available port for the built-app smoke check.
  port: Config.schema(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
    "DATABRICKS_APP_PORT",
  ).pipe(Config.withDefault(3000)),
  protocol: Config.Literals(["http1", "http2"], "APP_HTTP_PROTOCOL").pipe(
    Config.withDefault("http1"),
  ),
});
