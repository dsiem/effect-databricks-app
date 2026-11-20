import type { DatabricksCapability } from "../../server/src/databricks-capabilities.js";
import { type Input, Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Effect, Schema } from "effect";
import { cli, operation } from "./cli.ts";

interface Targets {
  sql_warehouse: { id: string };
  job: { id: number };
  genie_space: { name: string; space_id: string };
  postgres: { branch: string; database: string };
}

type AttachedResource = {
  [K in keyof Targets]: Record<
    K,
    Targets[K] & {
      permission: Extract<DatabricksCapability, { kind: K }>["permission"];
    }
  >;
}[keyof Targets];

type TargetInputs = {
  [K in keyof Targets]: { [P in keyof Targets[K]]: Input<Targets[K][P]> };
};

interface AppBinding {
  env: string;
  resource: AttachedResource;
}

interface AppProps {
  host: string;
  command: string[];
  env: Record<string, string>;
}

interface DeploymentConfig {
  command: string[];
  env_vars: (
    | { name: string; value: string }
    | { name: string; value_from: string }
  )[];
}

type App = Resource<
  "Databricks.App",
  AppProps,
  { name: string; id: string; deploymentConfig: DeploymentConfig },
  AppBinding
>;
export const App = Resource<App>("Databricks.App");

const appIdentity = Schema.Struct({
  name: Schema.String,
  id: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
});
const decodeApp = Schema.decodeUnknownSync(appIdentity);
const decodeApps = Schema.decodeUnknownSync(Schema.Array(appIdentity));

function ownershipMarker(instanceId: string) {
  return `Managed by Alchemy (instance ${instanceId})`;
}

async function findOwnedApp(
  host: string,
  name: string,
  instanceId: string,
  savedId?: string,
) {
  const listed = await cli(host, ["apps", "list"]);
  const app = decodeApps(JSON.parse(listed)).find((item) => item.name === name);
  if (
    app &&
    (app.description !== ownershipMarker(instanceId) ||
      (savedId && app.id !== savedId))
  ) {
    throw new Error(`A different Databricks app owns the name ${name}`);
  }
  return app;
}

export const appProvider = Provider.succeed(App, {
  diff: ({ olds, news }) =>
    Effect.succeed(
      "host" in news && typeof news.host === "string" && olds.host !== news.host
        ? { action: "replace" as const }
        : undefined,
    ),
  reconcile: ({ id, instanceId, olds, news, bindings, output }) =>
    operation(async () => {
      if (output && olds && olds.host !== news.host) {
        throw new Error("Changing an app's workspace requires replacement");
      }
      const label = id
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10);
      const name =
        output?.name ?? `alchemy-${label}-${instanceId.slice(0, 11)}`;
      const env_vars: DeploymentConfig["env_vars"] = Object.entries(
        news.env,
      ).map(([name, value]) => ({ name, value }));
      const aliases = new Set<string>();
      const resources = bindings.map(({ sid, data }) => {
        if (
          aliases.has(sid) ||
          env_vars.some((entry) => entry.name === data.env)
        ) {
          throw new Error(
            `Duplicate app binding alias or environment variable: ${sid} / ${data.env}`,
          );
        }
        aliases.add(sid);
        env_vars.push({ name: data.env, value_from: sid });
        const resource = data.resource;
        if ("job" in resource) {
          return {
            name: sid,
            job: { ...resource.job, id: String(resource.job.id) },
          };
        }
        return { name: sid, ...resource };
      });
      const body = { description: ownershipMarker(instanceId), resources };
      const existing = await findOwnedApp(
        news.host,
        name,
        instanceId,
        output?.id,
      );
      const result = existing
        ? await cli(news.host, ["api", "patch", `/api/2.0/apps/${name}`], body)
        : await cli(
            news.host,
            ["api", "post", "/api/2.0/apps?no_compute=true"],
            { ...body, name },
          );
      const app = decodeApp(JSON.parse(result));
      return {
        id: app.id,
        name: app.name,
        deploymentConfig: { command: news.command, env_vars },
      };
    }),
  delete: ({ instanceId, olds, output }) =>
    operation(async () => {
      if (await findOwnedApp(olds.host, output.name, instanceId, output.id)) {
        await cli(olds.host, ["api", "delete", `/api/2.0/apps/${output.name}`]);
      }
    }),
});

export const attachDatabricks =
  (app: App, targets: TargetInputs) => (binding: DatabricksCapability) => {
    const { alias, env } = binding;
    switch (binding.kind) {
      case "sql_warehouse":
        return app.bind(alias, {
          env,
          resource: {
            sql_warehouse: {
              ...targets.sql_warehouse,
              permission: binding.permission,
            },
          },
        });
      case "job":
        return app.bind(alias, {
          env,
          resource: { job: { ...targets.job, permission: binding.permission } },
        });
      case "genie_space":
        return app.bind(alias, {
          env,
          resource: {
            genie_space: {
              ...targets.genie_space,
              permission: binding.permission,
            },
          },
        });
      case "postgres":
        return app.bind(alias, {
          env,
          resource: {
            postgres: { ...targets.postgres, permission: binding.permission },
          },
        });
    }
  };
