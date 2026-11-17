# Deploy the Databricks app

Use the Node version in [.nvmrc](.nvmrc), npm 10, and Databricks CLI 1.26 or
later in the 1.x series. Start in the repository root.

Use a workspace with Databricks Apps, SQL, Genie, Lakebase Autoscaling, and the
NYC taxi sample files. Your deployment identity needs permission to manage the
bundle resources, create a schema in the selected catalog, and grant access to
the app. Lakebase setup needs a PostgreSQL role that can create tables
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
   and uses `databricks-effect-app-dev` for both the app and the schema. Set
   overrides first if your workspace needs [different names](#choose-resource-names).

   ```sh
   databricks bundle validate --strict -t dev
   databricks bundle plan -t dev
   ```

3. Deploy the bundle, seed the taxi data, and initialize Lakebase.

   ```sh
   npm run workspace:setup -- dev
   ```

   Setup starts the app, prints its URL, and writes the connection settings to
   `.env`. Open the URL once the Databricks Apps page shows **Running**.

## Develop locally

```sh
npm run dev
```

Open the frontend URL printed in the terminal. The local API uses your
Databricks CLI login. Set `DATABRICKS_CONFIG_PROFILE` in `.env` if you use a
named profile.

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

## Deploy from GitHub Actions

1. Create a GitHub environment called `dev` or `prod`. Configure federation for
   the Databricks service principal and that environment. [GitHub federation guide](https://docs.databricks.com/aws/en/dev-tools/auth/provider-github)
2. Set `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, and `DATABRICKS_APP_NAME` in the
   GitHub environment's **Variables** settings.
3. Set shared bundle variables in `databricks.yml` for CI. If both local and CI
   identities will deploy to the same target, use a shared, restricted
   `workspace.root_path`.
4. Run the [Deploy workflow](.github/workflows/deploy.yml) for that target.
