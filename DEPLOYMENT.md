# Deploy the Databricks app

Use the Node version in [.nvmrc](.nvmrc), npm 10, and Databricks CLI 1.26 or
later in the 1.x series. Start in the repository root.

Use a workspace with Databricks Apps, SQL, Genie, Lakebase Autoscaling, and the
NYC taxi sample files. Your deployment identity needs permission to manage the
bundle resources, create a schema in the selected catalog, and grant access to
the app. Lakebase setup needs a PostgreSQL role that can create tables
and grant access. [Lakebase permissions](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase)

## Set up a target

1. Install dependencies and sign in to your workspace.

   ```sh
   nvm install
   nvm use
   npm ci
   databricks auth login --host https://YOUR-WORKSPACE.cloud.databricks.com
   ```

   If you use a named profile, export `DATABRICKS_CONFIG_PROFILE` in your shell.

2. Review the bundle plan. By default, the `dev` target names the app and
   schema `databricks-effect-app-dev` and puts the schema in the `workspace`
   catalog. Set any name overrides before you run the plan. [Choose resource names](#choose-resource-names)

   ```sh
   databricks bundle validate --strict -t dev
   databricks bundle plan -t dev
   ```

3. Run the setup command once per target. The command creates the data resources
   and seeds the taxi snapshot. It deploys Genie and sets up Unity Catalog and
   Lakebase access before it starts the app.

   ```sh
   databricks bundle run bootstrap -t dev
   ```

   In Databricks Apps, open the app when its status is **Running**.

## Choose the taxi snapshot dates

Set `snapshot_start_date` and `snapshot_end_date` in the target's
`variable-overrides.json`. Use `YYYY-MM-DD` for both dates. Both are inclusive
and refer to New York local pickup time. The default is January 1 through
February 29, 2016.

To apply new defaults, deploy the bundle and rerun `seed_trip_snapshot`.
To override the dates for one run, pass both job parameters.

```sh
databricks bundle run seed_trip_snapshot -t dev \
  --params snapshot_start_date=2016-02-01,snapshot_end_date=2016-02-15
```

Each month needs a sample yellow taxi CSV with the 19-column schema that
includes pickup and drop-off coordinates. To list the files, run
`LIST '/Volumes/samples/databricks/datasets/nyctaxi/tripdata/yellow/'` in
Databricks SQL. Reruns reuse trip IDs, including when you change the range.

## Release an app update

If your deployment predates the `trips` and `trip_quality` tables, rerun
`databricks bundle run bootstrap -t dev`. Bootstrap preserves trip IDs and
grants the app access to both tables. For local development, rerun
`databricks bundle run local_env -t dev` to update `.env`.

For routine updates, deploy the bundle and start the app.

```sh
databricks bundle deploy -t dev
databricks bundle run app -t dev
```

## Develop locally

Write the connection settings to `.env` and start the client and API. If you
use a named profile, export `DATABRICKS_CONFIG_PROFILE` in your shell first.

```sh
databricks bundle run local_env -t dev
npm run dev
```

Open the frontend URL printed in the terminal. The local API uses your
Databricks CLI login.

## Verify the app

### Run local checks

Run the build and local tests, then exercise the UI against mocked API responses.

```sh
npm run check
npx playwright install chromium webkit
npm run test:browser
```

### Check hosted APIs

After a release, verify that SQL queries, trip maps, Lakebase, and Genie work
through the hosted app. The check creates and deletes a temporary saved view.

```sh
node scripts/check-deployed.mjs dev
```

### Run hosted browser tests

Run this suite manually with a signed-in Databricks browser session. The
[Deploy workflow](.github/workflows/deploy.yml) runs the hosted API check after
release.

Use a test deployment and an account with `CAN USE` permission on the app. Set
`DATABRICKS_APP_URL` to the URL shown in Databricks Apps.

```sh
export DATABRICKS_APP_URL='https://YOUR-APP.databricksapps.com'
npx playwright install chromium
mkdir -p .databricks
(
  umask 077
  npx playwright open --save-storage=.databricks/playwright-auth.json "$DATABRICKS_APP_URL"
)
```

Sign in to Databricks and close Chromium once the app loads. Keep the session
file local and repeat the sign-in when it expires. If you use a different
session file, set `DATABRICKS_APP_STORAGE_STATE` to its path.

The tests cover trip filtering, pagination, source details, and map hotspots.
They also create, reopen, and delete a temporary saved view in Lakebase.

If the snapshot excludes January 15, 2016, set `DATABRICKS_APP_TEST_DATE` to
an included date in `YYYY-MM-DD`. Choose a day with enough pickups in ZIP
`10001` for a second page of results.

```sh
npm run test:browser:deployed
```

## Choose resource names

Set workspace-specific values in `.databricks/bundle/dev/variable-overrides.json`.
Create the parent directory if needed. `data_catalog` names an existing Unity
Catalog catalog. The schema defaults to `data_name`. Set `data_schema` to use a
different schema name.

```json
{
  "app_name": "your-app-dev",
  "data_name": "your-data-dev",
  "data_catalog": "workspace"
}
```

For production, use `prod` in the commands and override path. Use distinct app
and data names for each target.

## Release from GitHub Actions

1. Create a GitHub environment called `dev` or `prod`. Configure federation for
   the Databricks service principal and that environment. [GitHub federation guide](https://docs.databricks.com/aws/en/dev-tools/auth/provider-github)
2. In the GitHub environment's **Variables** settings, set `DATABRICKS_HOST` and
   `DATABRICKS_CLIENT_ID`. Set `DATABRICKS_APP_NAME` to the target's `app_name`.
3. Use the same bundle variable values for setup and releases.

   If `dev` uses different identities for setup and releases, set a restricted
   `workspace.root_path` in `databricks.yml`. Give both identities access to the
   path and bundle resources.

   For `prod`, use the production service principal for setup and releases.
   The CLI creates missing folders if the principal has permission. Otherwise,
   have a workspace admin create the bundle folder under `/Workspace/Production`
   and grant the principal `CAN MANAGE`. Restrict write access to that principal.

4. For a new deployment, [set up the target](#set-up-a-target) once from the CLI.

   If `prod` already uses a path under `/Workspace/Users`, get the resource IDs
   with `databricks bundle summary -t prod` using the old configuration and
   identity. Bind the resources at the new path and confirm that
   `databricks bundle plan -t prod` uses them. [Databricks bundle binding](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands#databricks-bundle-deployment-bind)

   For app updates, run the [Deploy workflow](.github/workflows/deploy.yml)
   and select the target.
