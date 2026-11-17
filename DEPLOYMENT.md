# Deploy the Databricks app

Use the Node version in [.nvmrc](.nvmrc), npm 10, and Databricks CLI 1.26 or
later in the 1.x series. Start in the repository root.

Use a workspace with Databricks Apps, SQL, Genie, Lakebase Autoscaling, and the
NYC taxi sample files. Your deployment identity needs permission to manage the
bundle resources, create a schema in the selected catalog, and grant access to
the app. The Lakebase migration needs a PostgreSQL role that can create tables
and grant access. [Lakebase permissions](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase)

## Deploy the example

1. Install dependencies and sign in to your workspace.

   ```sh
   nvm install
   nvm use
   npm ci
   databricks auth login --host https://YOUR-WORKSPACE.cloud.databricks.com
   ```

   If you use a named profile, set `DATABRICKS_CONFIG_PROFILE` in your shell
   for the bundle commands.

2. Review the bundle plan. The `dev` target defaults to the `workspace` catalog
   and uses `metrocab-dev` for both the app and the schema. Set overrides first
   if your workspace needs [different names](#choose-resource-names) or uses an
   [existing app or warehouse](#use-an-existing-app-or-warehouse).

   ```sh
   databricks bundle validate --strict -t dev
   databricks bundle plan -t dev
   ```

3. Deploy the bundle, seed the taxi data, and migrate Lakebase.

   ```sh
   npm run workspace:setup -- dev
   ```

   Setup starts the app, prints its URL, and writes the connection settings to
   `.env`. Open the URL once the Databricks Apps page shows **Running**. Rerun
   setup to update the app and reuse the existing trip snapshot.

## Develop locally

```sh
npm run dev
```

Open the frontend URL printed in the terminal. The local API uses your
Databricks CLI login. Set `DATABRICKS_CONFIG_PROFILE` in `.env` if you use a
named profile. Run `npm run db:migrate` after changing the Lakebase schema.

## Verify the app

Run the build and local tests, then exercise the UI against mocked API responses.

```sh
npm run check
npx playwright install chromium webkit
npm run test:browser
```

After deployment, check the hosted app's SQL, maps, Lakebase, and Genie
connections. This creates and deletes a temporary saved view.

```sh
node scripts/check-deployed.mjs dev
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

The CLI stores bundle state under the deployer's workspace home by default. Use
the same `workspace.root_path` to update an existing deployment. If you deployed
`prod` to `/Workspace/Shared`, review the plan for moving it before deploying
with the new defaults. [Move a shared bundle deployment](https://docs.databricks.com/aws/en/dev-tools/bundles/faqs#how-do-i-move-a-bundle-deployment-off-workspaceshared)

## Use an existing app or warehouse

Before deploying, set `app_name` or `warehouse_name` to the existing name in your
target overrides. Match the existing warehouse settings in
[resources/warehouse.yml](resources/warehouse.yml). Bind the resources you want
the bundle to manage.

```sh
databricks bundle deployment bind app your-app-dev -t dev
databricks bundle deployment bind analytics EXISTING_WAREHOUSE_ID -t dev
```

Review `databricks bundle plan -t dev` after binding. Deployment applies the
declared settings, and `bundle destroy` can delete bound resources.
[Databricks resource binding](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands#databricks-bundle-deployment-bind)

## Deploy from GitHub Actions

1. Create a GitHub environment called `dev` or `prod`. Configure federation for
   the Databricks service principal and that environment. [GitHub federation guide](https://docs.databricks.com/aws/en/dev-tools/auth/provider-github)
2. Set `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, and `DATABRICKS_APP_NAME` in the
   GitHub environment's **Variables** settings.
3. Set shared bundle variables in `databricks.yml` for CI. If you deploy or bind
   locally with another identity, point both environments at the same restricted
   `workspace.root_path` so they use the same bundle state.
4. Run the [Deploy workflow](.github/workflows/deploy.yml) for that target.
