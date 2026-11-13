# Metrocab — a Databricks app composed with Effect

A working NYC taxi analytics workspace with React, Tailwind CSS 4, shadcn/ui and
Radix UI components, Recharts, and Leaflet. The data is the real
`samples.nyctaxi.trips` table. No synthetic dashboard data or mock Genie answers.

- **Overview:** fare and trip metrics, daily trends, hourly activity, top ZIP codes.
- **Trip explorer:** date/ZIP filters, server-side sorting and pagination, CSV export
  of the visible page.
- **Pickup map:** interactive ZIP-area choropleth using official NYC boundaries.
- **Ask Genie:** real conversations, follow-up questions, query results, generated
  SQL, and explicit date/ZIP filter context.
- **Analyst notebook:** shared notes, pinning, editing, deletion, and saved filter
  views persisted in Lakebase Postgres.

The sample contains 21,932 trips from January–February 2016 in the verified
workspace. It contains ZIP codes rather than GPS points. Fares exclude tips and
tolls. All dates and amounts in the UI come from the warehouse. The map groups
postal ZIPs into NYC Health MODZCTAs and explicitly counts unmapped trips.

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
no token is copied into the frontend. Alternatively, configure the resource IDs in
`.env` manually and run `npm run db:migrate` once.

`npm run build && npm start` serves the built frontend and API together on port
3000. Without data credentials the app shell and `/health` still work; data routes
return useful configuration errors instead of fabricated results.

## Deploy the complete stack

[databricks.yml](databricks.yml) declares and connects:

| Resource         | Configuration                                                      |
| ---------------- | ------------------------------------------------------------------ |
| SQL warehouse    | Serverless PRO, 2X-Small, one cluster, ten-minute auto-stop        |
| Genie space      | NYC taxi table, sample questions, domain instructions              |
| Lakebase project | Postgres 17, production branch, 1 CU primary endpoint              |
| Databricks App   | Existing or new app identity, SQL/Genie/Lakebase resource bindings |

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

Setup deploys the bundle, discovers the actual resources, runs an explicit,
idempotent notebook migration, grants the app identity access only to that schema
and table, and starts the app. Application startup does not run DDL. Re-run setup
to apply later source or infrastructure changes. The deployer needs resource
creation permissions and database ownership for migration/grants.

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

The local override preserves the pre-existing `effect-daniel-siemssen-dev` app in
the verified workspace. Bundle teardown also manages the adopted warehouse; review
`databricks bundle plan` before infrastructure changes or destroying a bundle.

The **Deploy** GitHub workflow uses the same setup command and GitHub OIDC.
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
- `@effect/sql-pg` owns a scoped PostgreSQL pool, TLS, per-connection fresh Lakebase
  OAuth credentials, statement/acquisition deadlines, and shutdown. Notebook saves
  are UUID-keyed upserts; migration uses a transaction and advisory lock.
- `NodeRuntime` manages graceful signal shutdown for HTTP/1.1 locally and HTTP/2
  as an optional transport. The verified workspace deployment uses HTTP/1.1; its proxy returned 502 for an HTTP/2-only listener.

The app uses its service principal for shared access. All app viewers can see and
edit the shared notebook; per-viewer row-level authorization is not implemented.

## Verify

```sh
npm run check          # lint, types, tests, build, both HTTP protocols, packed SQL adapter
npm run test:architecture # offline Genie recovery browser tests and service error checks
npm run bundle:check   # deployment schema validation without credentials
npm run data:check     # live SQL reconciliation, Lakebase CRUD, Genie + follow-up
node scripts/check-deployed.mjs dev  # verify actual hosted APIs and app-identity access
npx playwright install chromium
npm start              # separate terminal, with the configured .env
npm run test:e2e       # real browser checks, no mocked data routes
```

Live checks create and remove a temporary note. Browser checks verify filtering,
sorting, pagination, CSV, map rendering, responsive navigation, and notebook
persistence across reloads. Screenshots and traces go to ignored `test-results/`.

The map geometry is bundled for reproducible rendering; the street basemap uses
OpenStreetMap tiles. See [boundary provenance](client/public/SOURCES.md).
`node scripts/refresh-geography.mjs` refreshes the official boundary artifact.

Architecture and operational details: [docs/data-access.md](docs/data-access.md).
Inspiration: [Databricks vacation rentals template](https://developers.databricks.com/templates/vacation-rentals).
