# Databricks Apps + Effect

A working NYC taxi analytics workspace with Foldkit, Effect 4, Tailwind CSS 4,
SVG charts, and Leaflet. The app starts from the real
`samples.nyctaxi.trips` data and persists a managed snapshot for stable trip
identity. No synthetic dashboard data or mock Genie answers.

The UI uses a neutral theme with accessible native dialogs. The sidebar
collapses to icons on desktop, remembers that preference, and becomes a drawer
on mobile. Toggle it with the header button or **⌘B / Ctrl+B**.
The sidebar shows the viewer's name and email from Databricks Apps proxy headers;
local development uses the current workspace user's profile when available.

- **Overview:** fare and trip metrics, daily trends, hourly activity, top ZIP codes.
- **Trip explorer:** date/ZIP filters, server-side sorting and pagination, CSV export
  of the visible page. Open any trip to inspect its details and add shared,
  attributed comments persisted in Lakebase.
- **Pickup map:** interactive ZIP-area choropleth using official NYC boundaries.
- **Contextual Genie helper:** open Ask Genie from any page without leaving the
  data. Explain a chart, analyze visible trips, or ask for further analytics with
  the applied date/ZIP filters. Expand the helper for result tables and generated
  SQL; on mobile it opens as a sheet. The `/genie` conversation view is also available.
- **Saved views:** save the applied filters with an optional finding directly in
  Explore; reopen, pin, edit, or delete them from a side panel on the same page.
  The panel supports paginated browsing of the shared library.

An unscheduled SQL job copies `samples.nyctaxi.trips` once per bundle target into a
managed Delta table and persists a UUID `trip_id` on each row. App analytics read this snapshot;
re-running setup keeps its IDs and does not refresh its rows. The sample contains
21,932 trips from January–February 2016 in the verified workspace. It contains ZIP
codes rather than GPS points. Fares exclude tips and tolls. All dates and amounts
in the UI come from the warehouse. The map groups postal ZIPs into NYC Health
MODZCTAs and explicitly counts unmapped trips. Genie remains connected to the
source sample table; configure its data source alongside `data_catalog` when
adapting the bundle to a different dataset.

## Run locally

Use Node **22.23.5** (pinned in `.nvmrc`), npm 10, and Databricks CLI
**1.26 or newer, below 2.0**.

```sh
nvm install
nvm use
npm ci
cp .env.example .env
databricks auth login --host https://YOUR-WORKSPACE.cloud.databricks.com
npm run workspace:setup
npm run dev
```

Open http://localhost:5173 (frontend). The Effect API runs on port 3000. Setup
populates the ignored `.env` with resource IDs and connection parameters. Tokens
are obtained from the CLI locally and from the platform app identity when deployed;
no token is copied into the frontend. To rerun snapshot provisioning for a deployed
bundle target, run
`npm run data:seed:snapshot -- -t dev --params app_service_principal_id=<app-client-id>`
using that target's catalog/schema. Local analytics use `TRIP_SNAPSHOT_TABLE` from
`.env`. For manual Lakebase setup, configure its values in `.env`, then run
`APP_SERVICE_PRINCIPAL_ID=<app-client-id> npm run db:migrate`.

`npm run build && npm start` serves the built frontend and API together on port
3000. Without data credentials the app shell and `/health` still work; data routes
return useful configuration errors instead of fabricated results.

## Deploy the complete stack

[databricks.yml](databricks.yml) declares and connects:

| Resource         | Configuration                                                          |
| ---------------- | ---------------------------------------------------------------------- |
| SQL warehouse    | Serverless PRO, 2X-Small, one cluster, ten-minute auto-stop            |
| Unity Catalog    | Target-specific schema with a persistent copy of the taxi sample       |
| Snapshot job     | Unscheduled SQL notebook on the existing warehouse; preserves trip IDs |
| Genie space      | NYC taxi table, sample questions, domain instructions                  |
| Lakebase project | Postgres 17, production branch, 1 CU primary endpoint                  |
| Databricks App   | Existing or new app identity, SQL/Genie/Lakebase resource bindings     |

Lakebase project defaults include a five-minute idle suspension; the default
endpoint inherits it. The app uses the endpoint's direct TLS host. Resource names
are controlled by `app_name`, `data_name`, and `warehouse_name`. `dev` and `prod`
use separate target state and data projects. Development-mode automatic renaming
is deliberately disabled so an adopted, locked free-tier warehouse keeps its name.

```sh
npm run bundle:check
databricks bundle validate --strict -t dev
npm run workspace:setup -- dev
```

Set `data_catalog` and `data_schema` in the target's bundle variables, or supply
them as environment overrides when running setup:

```sh
BUNDLE_VAR_data_catalog=my_catalog BUNDLE_VAR_data_schema=my_schema npm run workspace:setup -- dev
```

Both the seed job and deployed app use `my_catalog.my_schema.trips`. Setup writes
that same fully qualified name to `TRIP_SNAPSHOT_TABLE` in the local `.env`.
The defaults remain `main` and `${var.data_name}` (for example, `metrocab-dev`),
preserving the existing table location. `data_schema` can be changed independently
of the warehouse and Lakebase resource prefix. Keep these overrides in the target
configuration for subsequent deployments. Changing the catalog or schema selects
a separate snapshot; existing trip IDs and comments are not migrated.

Setup deploys the bundle and waits for its `seed_trip_snapshot` SQL job to finish
on the existing warehouse. The job creates a target-specific managed Delta
snapshot with one persisted UUID per sample row, validates the IDs, and grants
the app identity catalog/schema/table read access. Setup then runs an explicit
idempotent notebook migration and starts the app.
Re-running setup preserves the snapshot and IDs; it does not copy newly changed
source rows. Application startup does not run DDL. The deployer needs permission
to create the schema in `data_catalog` and grant access to the app identity, plus
database ownership for the Lakebase migration/grants.

### Free workspace / adopting existing resources

The verified workspace is on the free tier: one warehouse total, locked warehouse
settings, fixed 1-CU Lakebase compute and five-minute suspension. Creating a second
warehouse returned `429 RESOURCE_EXHAUSTED` even after stopping the first. The
existing starter warehouse is therefore adopted into bundle state and its settings
are preserved. A paid workspace can create the declared warehouse directly.

For another free workspace, set the existing warehouse's display name in the
ignored `.databricks/bundle/dev/variable-overrides.json`, then bind it **before**
setup:

```json
{
  "app_name": "your-existing-app",
  "warehouse_name": "Serverless Starter Warehouse"
}
```

```sh
databricks bundle deployment bind analytics EXISTING_WAREHOUSE_ID -t dev
npm run workspace:setup -- dev
```

The local override preserves the existing app in your workspace. Bundle teardown
also manages the adopted warehouse; review
`databricks bundle plan` before infrastructure changes or destroying a bundle.

The **Deploy** GitHub workflow uses the same setup command and GitHub OIDC.
CI and deployment prechecks include the offline browser suite. After the app
reaches `RUNNING`, deployment must also pass hosted SQL, notebook persistence, and
Genie verification using the app identity.
Configure GitHub environments `dev` / `prod` with `DATABRICKS_HOST`,
`DATABRICKS_CLIENT_ID`, and `DATABRICKS_APP_NAME`, plus a Databricks federation policy
for the GitHub environment subject. An existing adopted warehouse must have its
bundle variable set to its current name in CI as well.

## Why Effect is central

The server is an Effect application, including HTTP routing and lifetime:

- `Settings`, `Workspace`, `Analytics`, `Genie`, and `Notebook` are typed
  `Context.Service`s assembled through `Layer`s.
- External inputs and API responses are decoded with `Schema`; `SqlSchema`
  validates warehouse and Lakebase rows at their boundaries. Frontend responses
  use the same domain schemas through interruptible Effect requests.
- The repository's reusable `effect-sql-databricks` adapter executes parameterized
  SQL over Arrow, including explicit INT pagination parameters. Credentials refresh
  through a shared provider. See its [README](packages/sql-databricks/README.md).
- `Cache` shares concurrent overview requests, caches successful results for a
  minute, bounds cache size, and immediately expires failures. `Effect.all` bounds
  warehouse concurrency; tracing spans identify domain operations.
- Genie submission returns conversation/message IDs immediately. Status polling
  and result downloads are separate, interruptible reads; browser-session
  recovery survives navigation and reload. Failed downloads can be retried using
  the same IDs. The UI shows at most 100 result rows and labels partial previews.
  Writes and conversation submissions are not automatically retried.
- Genie questions carry the current page or selected chart's bounded data
  snapshot and applied filters. Each turn retains its original scope; navigation,
  changed filters, and changed trip sorting update the next question's context.
  The layout owns polling so answers continue while the helper is closed.
  Client snapshots provide explanatory context; additional analytics query the
  source table rather than extrapolating from visible rows or ranked subsets.
- `@effect/sql-pg` owns a scoped PostgreSQL pool, TLS, per-connection fresh Lakebase
  OAuth credentials, statement/acquisition deadlines, and shutdown. Notebook saves
  use explicit create/update versions and return conflicts for stale writes.
  Pinning updates only its own field. Migration uses a transaction and advisory
  lock; run `npm run db:migrate` to add note versions and the trip-comments table
  to existing installations. Comment submissions use a stable draft ID so retrying
  after a lost response does not create duplicates; authors come from the server's
  current-viewer identity.
- `NodeRuntime` manages graceful signal shutdown for HTTP/1.1 locally and HTTP/2
  as an optional transport. The verified workspace deployment uses HTTP/1.1; its proxy returned 502 for an HTTP/2-only listener.

The app uses its service principal for shared access. All app viewers can see and
edit shared saved views; per-viewer row-level authorization is not implemented.
Trip comments are shared and append-only through the API. The replicated sample
gets a persisted synthetic `trip_id`; future apps should copy a source primary key
when one exists. See the [interaction design rationale](docs/data-access.md#contextual-workflows).

## Verify

```sh
npm run check          # lint, types, tests, build, both HTTP protocols, packed SQL adapter
npm run test:browser   # offline browser checks against the built app; also required in CI
npm run test:architecture # offline Genie recovery, sidebar/dialog/responsive UI, and service checks
node scripts/preview-notebook-options.mjs # regenerate the three interactive UX prototypes
npm run bundle:check   # deployment schema validation without credentials
npm run data:check     # live SQL reconciliation, Lakebase CRUD, Genie + follow-up
npm run data:check:comments # live trip comments, safe retries, and temporary-row cleanup
node scripts/check-deployed.mjs dev  # verify actual hosted APIs and app-identity access
npx playwright install chromium # required once before either browser suite
npm start              # separate terminal, with the configured .env
npm run test:e2e       # real browser checks, no mocked data routes
```

Live checks create and remove a temporary note. Browser checks verify filtering,
sorting, pagination, CSV, map rendering, responsive navigation, and notebook
persistence across reloads. Screenshots and traces go to ignored `test-results/`.

The map geometry is bundled for reproducible rendering; the street basemap uses
OpenStreetMap tiles. See [boundary provenance](client/public/SOURCES.md).
`node scripts/refresh-geography.mjs` refreshes the official boundary artifact.

Frontend state lives in a Schema-defined Foldkit model. Messages enter the pure
`update` function, which returns the next model and named Effect commands. URL
navigation, HTTP requests, persistence, clipboard, and downloads run through
commands; browser events use a subscription and Leaflet uses a scoped mount.
There are no component-local stores or hook lifecycles. `client/src/main.ts` boots
the runtime, while `model.ts`, `message.ts`, `update.ts`, and the stateless views
can be inspected independently. Run `npm run client:check` to audit the migration
and `npm run test:browser` to exercise the UI and recovery workflows offline.

Interactive controls use `@foldkit/ui`: Select for trip sorting, Tabs for chart
metrics, Tooltip for the collapsed sidebar, Calendar for date navigation, and
Dialog for modal sheets and editors. Button, Input, and Textarea render helpers
supply the form controls. Keep their interaction behavior in Foldkit UI and apply
app styling through the components' attribute bundles. `client:check` rejects
hand-built widget roles and custom dialog focus traps.

Architecture and operational details: [docs/data-access.md](docs/data-access.md).
Inspiration: [Databricks vacation rentals template](https://developers.databricks.com/templates/vacation-rentals).
