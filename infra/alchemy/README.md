# Databricks Apps with Alchemy

This prototype gives the taxi workbench its own Databricks App, analysis job and
workspace SQL file. It takes the existing SQL warehouse, Genie space and
Lakebase branch as inputs. The stack uses Alchemy 2's Effect API and the
Databricks CLI's workspace authentication.

## Bind an Effect service

The stack evaluates [the workbench's service composition](../../server/src/databricks-services.ts)
with a Databricks attachment function. The server evaluates the same composition
at startup and builds the returned Layers. Planning the infrastructure never
opens a SQL connection or requests a runtime token.

For example, selecting `bindWarehouseClient(attach)` does three things.

1. It registers the `lakehouse` attachment on the app. The provider fills in
   the warehouse chosen by the stack and requests `CAN_USE` for the app's
   service principal.
2. It contributes `DATABRICKS_WAREHOUSE_ID` with `value_from: lakehouse` to
   the app deployment. The capability also defines the Effect Config that reads
   this value once Databricks injects it.
3. It returns the [configured SQL Layer](../../server/src/warehouse.ts).
   `Analytics.fromWarehouse` consumes the injected `DatabricksClient`.
   The client obtains runtime tokens through the existing `Workspace` service.

The stack supplies physical targets. The app's capabilities own their
permissions, aliases and runtime configuration keys. The job's target can be an
unresolved Alchemy output, so the app depends on the job, which in turn depends
on the uploaded SQL file. [Stack](alchemy.run.ts) ·
[Capability definitions](../../server/src/databricks-capabilities.ts)

| Runtime service  | App attachment    | Permission             |
| ---------------- | ----------------- | ---------------------- |
| DatabricksClient | lakehouse         | CAN_USE                |
| AnalysisRuns     | route-reliability | CAN_MANAGE_RUN         |
| Genie            | genie             | CAN_RUN                |
| Lakebase         | lakebase          | CAN_CONNECT_AND_CREATE |

Databricks accepts resource permissions on the app and runtime environment
overrides on its deployment. The provider generates both payloads from the
binding. [Apps API](https://docs.databricks.com/api/apps/v1/create-app) ·
[Deployment API](https://docs.databricks.com/api/apps/v1/deployment)

## Try it locally

From the repo root, use the Node version in `.nvmrc`. The example inputs let
you preview the graph without workspace credentials.

```sh
npm ci
npm run build --workspaces --if-present
cd infra/alchemy
npm ci
npm run plan -- --stage demo --env-file example.env
```

The initial plan shows three resources to create and four bindings on
`TaxiApp`. To exercise the lifecycle, install Databricks CLI 1.26 and run
`npm test` here. The test runs the installed Alchemy and Databricks CLIs
against a temporary HTTP server on loopback. It then resolves the emitted
deployment environment and uses the app's real service Layers to submit a SQL
statement, list job runs, start a Genie conversation, and discover the Lakebase
endpoint against local fixtures. Run `npm run typecheck` to check the resource
and attachment types.

## Try a workspace

Copy `example.env` to `.env` in this directory. Replace the example values with
an existing writable workspace directory, warehouse, data catalog and schema,
Genie space, and Lakebase branch. Authenticate the Databricks CLI to that host.
For a named profile, export `DATABRICKS_CONFIG_PROFILE` in the shell.
The deploying identity needs permission to create jobs and apps, write the SQL
file, and attach the referenced services.

```sh
npm run plan -- --stage sandbox
npm run deploy -- --stage sandbox
npx --no-install alchemy state read --backend local TaxiWorkbench/sandbox/output
```

Deploy uploads the SQL file, configures the job, and creates an app with
compute off. The job has no schedule. The generated app name and file path
belong to this Alchemy instance. The stack outputs include the job ID and the
app's deployment configuration. Keep `.alchemy/state` for updates and teardown,
use one writer per stage, and give each workspace its own stage.

To release code, first stage the workbench source in a workspace directory and
grant the new app principal the data permissions described below. With
`APP_SOURCE` set to that directory, use the stack output to deploy the code
with all four runtime bindings. These Bash commands use `jq`.

```sh
outputs=$(npx --no-install alchemy state read --backend local TaxiWorkbench/sandbox/output)
export DATABRICKS_HOST=$(jq -r .workspaceHost <<<"$outputs")
app=$(jq -r .appName <<<"$outputs")
release=$(jq --arg src "${APP_SOURCE:?Set APP_SOURCE to the staged workspace path}" \
  '.deploymentConfig + {source_code_path: $src}' <<<"$outputs")
databricks apps deploy "$app" --json "$release"
```

To remove the prototype app, job and SQL file, run
`npm run destroy -- --stage sandbox` from this directory with the same configuration.

## Replacing the rest of the bundle

An app attachment handles access to the attached service. The taxi app also
needs Unity Catalog table grants and PostgreSQL privileges for its own service
principal. The existing [bootstrap script](../../scripts/setup-workspace.mjs)
sets those up for the bundle app. A separately created Alchemy app has its own
principal.

A full migration also needs ownership of the warehouse, schema and volume,
Lakebase project, branch and endpoint, Genie provisioning, snapshot seeding,
app source sync and the release workflow. Port those in bootstrap order and
choose a handoff for each existing resource before retiring the bundle state.
The local state backend in this prototype would need durable shared storage
and deployment serialization for CI.
