import { PgClient } from "@effect/sql-pg";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
  type Scope,
} from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as SqlClient from "effect/sql/SqlClient";
import type { CapabilityAvailability } from "../shared/domain.js";
import { makeCapability } from "./capability.js";
import { type ServiceError, unavailable } from "./errors.js";
import { pgPassword } from "./pg-credentials.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

export type LakebaseSql = SqlClient.SqlClient & Pick<PgClient.PgClient, "json">;

export const lakebaseUnavailable = (cause?: unknown) =>
  unavailable(
    "lakebase",
    "Lakebase is unavailable. Check its connection settings, database grants, and run npm run db:migrate.",
    cause,
  );

const Credential = Schema.Struct({ token: Schema.NonEmptyString });
const Endpoint = Schema.Struct({
  status: Schema.Struct({
    hosts: Schema.Struct({ host: Schema.NonEmptyString }),
  }),
});
export const makeLakebaseClient = Effect.gen(function* () {
  const settings = yield* Settings;
  const workspace = yield* Workspace;
  const host =
    settings.pgHost ||
    (yield* workspace
      .request(`/api/2.0/postgres/${settings.lakebaseEndpoint}`)
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Endpoint)),
        Effect.map((endpoint) => endpoint.status.hosts.host),
      ));
  const password = Redacted.value(settings.pgPassword)
    ? Effect.succeed(settings.pgPassword)
    : pgPassword(
        workspace
          .request("/api/2.0/postgres/credentials", "POST", {
            endpoint: settings.lakebaseEndpoint,
          })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Credential)),
            Effect.map((credential) => Redacted.make(credential.token)),
            Effect.mapError((cause) =>
              unavailable(
                "lakebase",
                "Lakebase credentials could not be refreshed. Check workspace authentication and endpoint permissions.",
                cause,
              ),
            ),
          ),
      );
  return yield* PgClient.make({
    host,
    port: settings.pgPort,
    database: settings.pgDatabase,
    username: settings.pgUser || settings.clientId,
    password,
    ssl: true,
    minConnections: 0,
    maxConnections: 4,
    connectTimeout: "15 seconds",
    acquireTimeout: "20 seconds",
    idleTimeout: "30 seconds",
    connectionTTL: "45 minutes",
    startupParameters: { statement_timeout: "15000" },
    applicationName: "metrocab-effect",
  });
});

export class Lakebase extends Context.Service<
  Lakebase,
  {
    readonly availability: Effect.Effect<CapabilityAvailability>;
    /** Run a feature operation on the shared client and record its outcome. */
    readonly use: <A, R>(
      run: (sql: LakebaseSql) => Effect.Effect<A, ServiceError, R>,
    ) => Effect.Effect<A, ServiceError, R>;
  }
>()("app/Lakebase") {
  static readonly layer = Layer.effect(
    Lakebase,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const configured = !!(settings.pgHost || settings.lakebaseEndpoint);
      const capability = makeCapability(configured);
      if (!configured) {
        const failure = unavailable(
          "lakebase",
          "Configure Lakebase with PGHOST, PGUSER, and LAKEBASE_ENDPOINT, then run npm run db:migrate.",
        );
        return {
          availability: capability.availability,
          use: () => Effect.fail(failure),
        };
      }
      const context = yield* Effect.context<
        Settings | Workspace | Reactivity.Reactivity | Scope.Scope
      >();
      // One pool per service lifetime. Failed or interrupted discovery can retry;
      // initialization stays lazy so an outage cannot block application startup.
      const client = yield* makeLakebaseClient.pipe(
        Effect.mapError(lakebaseUnavailable),
        Effect.provide(context),
        Effect.cachedWithTTL((exit) => (Exit.isSuccess(exit) ? Infinity : 0)),
      );
      return {
        availability: capability.availability,
        use: <A, R>(
          run: (sql: LakebaseSql) => Effect.Effect<A, ServiceError, R>,
        ) => client.pipe(Effect.flatMap(run), capability.track),
      };
    }).pipe(Effect.provide(Reactivity.layer)),
  );
}
