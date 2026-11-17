# Deploy and adapt the app

Deployment uses a Databricks bundle: the app and service configuration in
[databricks.yml](databricks.yml). The Databricks CLI reads that file to create
or update the resources together.

Run commands from the repository root. Use the Node version in [.nvmrc](.nvmrc),
npm 10, and Databricks CLI `>=1.26.0 <2.0.0`.

Use a workspace with Databricks Apps, SQL, Genie, Lakebase Autoscaling, and the
sample files named in [the ingestion job](jobs/seed-trip-snapshot.sql).
Your deployment identity needs permission to create or manage those resources,
create a schema in the selected catalog, and grant the app access.
For an existing Lakebase project, obtain
[`CAN MANAGE`](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase).
Use a PostgreSQL role that can run the application migration and grant table access.

## Deploy a target

1. Install dependencies and sign in to your workspace:

   ```sh
   	nvm install
   	nvm use
   	npm ci
   	databricks auth login --host https://YOUR-WORKSPACE.cloud.databricks.com
   ```

2. Create `.databricks/bundle/dev/variable-overrides.json` with your resource names:

   ```sh
   	mkdir -p .databricks/bundle/dev
   ```

   ```json
   {
     "app_name": "your-app-dev",
     "data_name": "your-data-dev",
     "data_catalog": "workspace"
   }
   ```

   Use an existing catalog in `data_catalog`. To choose a different schema, add
   `data_schema`. Its default is `data_name`. Keep these values for subsequent runs.
   The file is ignored by Git.

3. If you reuse resources, bind them before deployment:
   - For an existing warehouse, add `warehouse_name` with its exact display name
     to the overrides. Match its settings in `resources.sql_warehouses.analytics`
     in [databricks.yml](databricks.yml). Then bind its ID:

     ```sh
     	databricks bundle deployment bind analytics EXISTING_WAREHOUSE_ID -t dev
     ```

   - For an existing app, set `app_name` to its name. Then bind that name:

     ```sh
     	databricks bundle deployment bind app your-app-dev -t dev
     ```

   If your workspace cannot create another warehouse, use its existing warehouse.
   Binding makes the bundle manage the resource. Deployment applies the declared
   settings, and `bundle destroy` can delete adopted resources. See
   [resource binding](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands#databricks-bundle-deployment-bind).

4. Validate the configuration and review the plan:

   ```sh
   	npm run bundle:check
   	databricks bundle validate --strict -t dev
   	databricks bundle plan -t dev
   ```

   For a warehouse with locked settings, resolve every planned warehouse change
   before deployment.

5. Deploy the resources, prepare the data, migrate Lakebase, and start the app:

   ```sh
   	npm run workspace:setup -- dev
   ```

   Use the URL printed after `Metrocab deployed:`. Setup also fills the local `.env`.
   Rerun the same command to update the app while preserving existing snapshot IDs.

6. Wait for **RUNNING** in the Databricks Apps page. Then verify the hosted app:

   ```sh
   	node scripts/check-deployed.mjs dev
   ```

   Expect `Deployed app verified:`. The check covers SQL, maps, a temporary saved
   view, and Genie through the app's identity.

For production, use `prod` in commands and the override path. Use distinct app and
data names for each target.

## Develop locally

After setup, start the frontend and API:

```sh
npm run dev
```

Open the frontend URL printed in the console. Use your CLI login for data access.
To select a named profile, set `DATABRICKS_CONFIG_PROFILE` in `.env`.
Keep `.env` out of Git.

## Adapt the example

1. Replace the source and cleaning rules in [the ingestion job](jobs/seed-trip-snapshot.sql).
2. Update [the shared domain](shared/domain.ts), [HTTP contract](shared/api.ts),
   and [analytics queries](server/src/analytics.ts) for your dataset.
3. Update the Genie tables and instructions in [databricks.yml](databricks.yml).
4. Replace the taxi controls and views in [client/src/features](client/src/features).
5. Add the authorization your records require at the HTTP boundary in [server/src/routes.ts](server/src/routes.ts).

Use [client/src/ui/styles.css](client/src/ui/styles.css) to reuse the visual
helpers. Change the palette and semantic tokens in
[client/src/ui/theme.css](client/src/ui/theme.css).

## Check a change

Run `npm run format` to format with Oxfmt and `npm run lint` for Oxlint
with type-aware rules. Use `npm run lint:fix` for automatic lint fixes.

Run the local checks, then the browser suites:

```sh
npm run check
npx playwright install chromium webkit
npm run test:browser
npm run test:filters
```

For UI changes, run `npm run test:ui` and inspect its screenshots in `test-results/`.
After deployment, run `node scripts/check-deployed.mjs dev` to verify the hosted
SQL, maps, saved views, and Genie APIs.

`npm test` checks the API contracts, services, and client behavior. After building,
`npm run test:dist` checks app startup and the packed SQL adapter. `npm run check`
runs both suites in order.

## Deploy from GitHub Actions

1. Configure [GitHub workload identity federation](https://docs.databricks.com/aws/en/dev-tools/auth/provider-github)
   for the deployment service principal and your GitHub environment subject.
2. Create the GitHub environment `dev` or `prod`. Set its `DATABRICKS_HOST`,
   `DATABRICKS_CLIENT_ID`, and `DATABRICKS_APP_NAME` variables.
3. Put the target's shared resource variables in `databricks.yml`. Local overrides
   are unavailable in CI. Include `warehouse_name` when adopting a warehouse.
4. Use the same target `workspace.root_path` for the initial bindings and CI.
   The default `dev` path depends on the deployer. Set a shared path before
   binding if your local and CI identities differ. `prod` already has a shared path.
5. Run the [Deploy workflow](.github/workflows/deploy.yml) with that target.

Use the [Databricks Apps CI guide](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/cicd-github-actions)
for federation and existing-app configuration details.
