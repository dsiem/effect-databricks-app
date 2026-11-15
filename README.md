# Databricks Apps + Effect

A working NYC taxi analytics workspace with Foldkit, Effect 4, Tailwind CSS 4,
SVG charts, and MapLibre GL JS with deck.gl. The app processes the complete
January–February 2016 yellow taxi CSVs bundled with Databricks into managed
Delta tables with stable trip identity. No synthetic dashboard data or mock Genie answers.

The UI pairs Foldkit's accessible behavior with a small, reusable visual layer:
neutral surfaces, an indigo accent, consistent controls, and responsive data panels.
`client/src/styles.css` composes the visual layer: reusable helpers and styles in
`client/src/ui/`, shell styles in `app/`, and feature styles beside their views. The sidebar
collapses to icons on desktop, remembers that preference, and becomes a drawer
on mobile. Toggle it with the header button or **⌘B / Ctrl+B**.
The Appearance menu above the sidebar profile follows Foldkit's Dark / Light / System selector. It
remembers your choice in this browser, defaults to the system theme, and applies
it before the app loads. System mode follows appearance changes automatically.
The sidebar shows the viewer's name and email from Databricks Apps proxy headers;
local development uses the current workspace user's profile when available.

- **Overview:** fare and trip metrics, daily trends, hourly activity, top ZIP codes.
- **Trip explorer:** date/ZIP filters, server-side sorting and pagination, CSV export
  of the visible page. Open any trip to inspect its details and add shared,
  attributed comments persisted in Lakebase.
- **Trip map:** interactive pickup and drop-off density with fine H3 hexagons.
- **Contextual Genie helper:** open Ask Genie from any page without leaving the
  data. Explain a chart, analyze visible trips, or ask for further analytics with
  the applied date/ZIP filters. Expand the helper for result tables and generated
  SQL; on mobile it opens as a sheet. The `/genie` conversation view is also available.
- **Saved views:** save the applied filters with an optional finding directly in
  Explore; choose, pin, edit, or delete them from the view chooser beside the filters.
  Choosing a view applies it on the current page and replaces pending edits.
  The chooser supports paginated browsing of the shared library.

The trip map uses MapLibre GL JS for OpenStreetMap streets and camera
control, with deck.gl polygons showing recorded endpoints at H3 resolution 10.
Its renderer and Vite worker load when the map mounts. Filters and endpoint
selection update the mounted map while preserving the camera. The map follows
the app theme and supports area selection by pointer or the busiest-area list.
Open `/gps-map` to switch between pickups and drop-offs. Run
`npm run data:check:gps` to reconcile both full-data maps and a filtered cohort.
The [three-map comparison](design/maps/DECISION.md) records the design evidence.

Trip details and CSV exports include recorded pickup/drop-off GPS endpoints,
passenger counts, payment type, itemized charges and source-file lineage. The map
aggregates recorded GPS endpoints; these do not describe the driven route.

The unscheduled ingestion job reads
`/Volumes/samples/databricks/datasets/nyctaxi/tripdata/yellow/yellow_tripdata_2016-0[12].csv.gz`
with an explicit 19-column schema. `trips_2016_raw` preserves **22,288,907** source
rows, all original fields, persisted UUIDs and quality flags. `trips_2016` contains
**22,145,892** accepted trips: pickup in January–February 2016, positive finite
fare and distance, and duration greater than zero and no more than 24 hours.
The **143,015** excluded records remain in raw; `trip_quality_2016` reports counts
by source file. Missing GPS never removes otherwise valid trips or revenue.
Coordinates outside the broad NYC region (longitude -75 to -72, latitude 40 to 42)
are flagged and presented as unavailable in the API.

All original GPS values stay in Delta. ZIP labels are derived using exact
point-in-polygon tests against pinned Census 2020 ZCTAs distributed by NYC Open
Data. They are approximate ZIP areas, not recorded postal addresses or historical
2016 boundaries. Unmatched locations stay NULL. The GPS map aggregates recorded
endpoints independently of ZIP boundaries.
Source timestamps are New York local wall-clock values stored as `TIMESTAMP_NTZ`.
Fare revenue excludes tips and tolls; recorded tips and total charges exclude
cash tips. Genie and app analytics query the same target-specific `trips_2016`.

Re-running ingestion keeps existing tables and trip IDs. The former six-column
`trips` demo and its comment records remain intact. Use a new table version for a
source refresh or a changed cleaning/boundary policy.

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
no token is copied into the frontend. To prepare and validate data on an existing bundle target without restarting the app,
run `npm run data:prepare -- dev`. To rerun the deployed ingestion job, run
`npm run data:seed:snapshot -- -t dev --params app_service_principal_id=<app-client-id>`
using that target's catalog/schema. Local analytics use `TRIP_SNAPSHOT_TABLE` from
`.env`. For manual Lakebase setup, configure its values in `.env`, then run
`APP_SERVICE_PRINCIPAL_ID=<app-client-id> npm run db:migrate`.

`npm run build && npm start` serves the built frontend and API together on port
3000. Without data credentials the app shell and `/health` still work; data routes
return useful configuration errors instead of fabricated results.

## Deploy the complete stack

[databricks.yml](databricks.yml) declares and connects:

| Resource         | Configuration                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| SQL warehouse    | Serverless PRO, 2X-Small, one cluster, ten-minute auto-stop                   |
| Unity Catalog    | Target-specific schema with raw, accepted trips, geography and quality counts |
| Snapshot job     | Unscheduled SQL notebook on the existing warehouse; preserves trip IDs        |
| Genie space      | NYC taxi table, sample questions, domain instructions                         |
| Lakebase project | Postgres 17, production branch, 1 CU primary endpoint                         |
| Databricks App   | Existing or new app identity, SQL/Genie/Lakebase resource bindings            |

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

Both the seed job and deployed app use `my_catalog.my_schema.trips_2016`. Setup writes
that same fully qualified name after successful ingestion to `TRIP_SNAPSHOT_TABLE` in the local `.env`.
The defaults are `workspace` and `${var.data_name}` (for example, `metrocab-dev`),
preserving the existing catalog/schema selection. `data_schema` can be changed independently
of the warehouse and Lakebase resource prefix. Keep these overrides in the target
configuration for subsequent deployments. Changing the catalog or schema selects
a separate snapshot; existing trip IDs and comments are not migrated.

Setup deploys the bundle, uploads pinned boundaries to its `taxi_sources` volume,
and waits for its `seed_trip_snapshot` SQL job to finish
on the existing warehouse. The job creates target-specific managed Delta
source and accepted-trip tables with persisted UUIDs, validates the IDs, and grants
the app identity catalog/schema/table read access. Setup then runs an explicit
idempotent application-schema migration and starts the app.
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
reaches `RUNNING`, deployment must also pass hosted SQL, saved-view persistence, and
Genie verification using the app identity.
Configure GitHub environments `dev` / `prod` with `DATABRICKS_HOST`,
`DATABRICKS_CLIENT_ID`, and `DATABRICKS_APP_NAME`, plus a Databricks federation policy
for the GitHub environment subject. An existing adopted warehouse must have its
bundle variable set to its current name in CI as well.

## Code organization

`src/` contains server implementations; `shared/` contains browser-safe domain
schemas and the HTTP contract. Both builds compile the same contract. Server
output starts at `dist/src/main.js`, with contracts in `dist/shared/`.

`client/src/main.ts` boots the runtime. `app/` composes the shell, routing,
feature state, and message union. Each directory under `features/` owns its
`Model`, initializer, message union, reducer, commands, and view contract.
The root model nests those models under named state fields. Feature reducers
receive only their own state and an explicit, read-only `Context`; they return
local state, commands, and optional typed outputs. The application interprets
outputs such as navigation, page reloads, and selection invalidation. Features
keep one Foldkit runtime and never import `app/` or sibling features.
Feature views use `defineView` and are embedded through Foldkit submodels;
`ViewModel` lists any extra inputs supplied by the application; views needing
only feature state use their own `Model`. View messages combine local messages
with explicit intents such as `Analyze`, `Reload`, and `SelectZip`.
`app/view-messages.ts` translates those intents into the destination feature's
messages. An overview or map view never imports Genie or filter messages.

Features also own their controls and dialog lifecycles: overview owns metric
selection; trips owns its inspector; saved views owns its editor, deletion
guards, and picker focus return; Genie owns conversation recovery and its helper
dialog. The shell owns the navigation drawer and supplies presentation context
when Genie switches between a desktop panel and a mobile dialog. Navigation
retains cleanup commands returned by feature resets.
Stateless `ui/` components are
generic over the caller's message type and import no app or domain state.
`domain/` holds shared application vocabulary and stateless helpers for filter
URLs, filter summaries, and analysis requests. It imports no feature state.
`lib/` holds transport, formatting, request, and generic lifecycle helpers.
The independently packed
SQL adapter stays under `packages/sql-databricks/`.

Add domain schemas and API endpoints in `shared/`, implement server behavior in
`src/`, and place client behavior beside its feature. Add its nested state and
message definitions in `app/model.ts` and `app/message.ts`, then dispatch its
reducer from `app/update.ts`. Interpret its outputs there and pass only the
inputs declared by its `Context` and `ViewModel`. A feature can be initialized
and its reducer exercised without constructing the rest of the application.
Keep application-specific copy in feature views. Use named
button options (`label`, `onClick`, `variant`, `className`, `attributes`) and pass
only a dialog's own model and message mapper to the generic dialog shell.
This is an application blueprint: prefer standard `@foldkit/ui` behavior and
native HTML over adding a component framework. The small SVG chart and native
table helpers cover the app's analytics needs; Foldkit UI has no chart or table
component. Charts take named `kind`, `data`, `title`, and optional value/tick
formatters, and include zero when scaling signed values. Tables take a caption,
headers, and keyed cell rows. Use source identities such as `trip_id` or ZIP for
changing records; positional keys suit immutable Genie result snapshots.

### Reusing the visual components

The [visual layer guide](client/src/ui/README.md) lists the component styles,
their dependencies, and how to use them in another application. Import
`ui/styles.css` after Tailwind for the complete reusable layer. It contains no
shell, feature, or map vendor styles. `src/styles.css` is the application-only
composition point; its imports make the ownership and cascade order explicit.

[Foldkit UI is headless](https://foldkit.dev/ui/overview): its attribute bundles
provide behavior and accessibility, while the application supplies markup and
styles in `toView`. The [official showcase](https://foldkit.dev/example-apps/ui-showcase)
uses this same separation, with styled controls, an accent palette, and state
selectors. Removing that visual layer does not produce a styled default UI.

Use `button` for actions and form submissions (`type: "submit"`), with `primary`,
`outline`, `ghost`, or `destructive` variants and `default`, `small`, or `icon`
sizes. Pass `disabled` to keep Foldkit's state attributes and native behavior in
sync. `field` renders a labeled Foldkit input; `metric` takes a label, formatted
value, detail, and optional icon; `panelHeader` takes a title, description, and
actions. `card`, `table`, `title`, and `dialog` supply the remaining shared
structure. These helpers are generic over the caller's message type and contain
no dataset or application state. Stateful interactions remain Foldkit submodels.
Use `busy` for an in-flight button action: Foldkit suppresses activation and
reports the busy state while keyboard focus stays on the control.

`filterPanel` composes an arbitrary array of filter controls, a view picker, a save
action, and the apply/reset workflow. It knows nothing about field names, value
types, query parameters, or the dataset. A caller can supply text, numeric, select,
checkbox, or custom Foldkit controls. `viewPicker` provides the styled Foldkit
Popover shell; `viewOption` takes a name, caller-rendered summary, description,
selection state, and optional management actions. Neither imports the saved-view
API or interprets a filter value. The unit examples exercise inventory filters
and incident views with independent message types.

The taxi-specific controls are in `features/filters/view.ts`, their URL/schema
rules in `domain/filters.ts` and `shared/domain.ts`, and their display
summary in `domain/filter-summary.ts`. Adapt these definitions and the
matching API contract for another dataset; keep the generic panel and chooser.
`field` accepts the input types supported by Foldkit's `Input.ViewConfig`.

The applied URL is the data source of truth. Edits remain pending until Apply;
the panel shows the filters still being displayed, and saving stays unavailable
until pending changes are applied. Invalid date order reports an inline error
without replacing the current results. Reset clears both draft and applied
filters. Opening a saved view replaces the draft even when its URL already
matches the page. Editing a saved definition keeps its original filters and does
not apply that definition to the current page.

The reusable `dateField` pairs an editable ISO date with Foldkit's DatePicker.
Calendar bounds come from the dataset and the opposite endpoint, making invalid
days unselectable. Empty start and end calendars open at their respective range
boundaries; selected dates open at their selection. Typed dates receive the same
range and ordering validation when applied. Touch devices use 16px input text.
The chooser uses Foldkit's
modal Popover lifecycle for outside dismissal, Escape, background inertness,
scroll locking, and focus return; native dialogs handle editing and deletion.

Change the brand palette in `ui/theme.css`'s `@theme` and the surface, text,
border, radius, and chart tokens in its `:root` and `:root.dark` rules.
Component styles sit beside their TypeScript helpers, including responsive,
touch, and reduced-motion rules. Shell and feature styles live in their own
`styles.css` files; the map feature owns its vendor stylesheet and overrides.
Component classes define appearance; feature utilities
compose layouts. Tabs style `aria-selected` and navigation styles `aria-current`
directly, so visual state follows Foldkit's actual state. Chart `width` controls
the SVG coordinate space (400 for the compact hourly panel, 700 by default),
keeping axis labels readable in panels of different sizes.

After changing the UI, run `npm run build && npm run test:ui`. The offline review
renders populated overview, trip, map, Genie, saved-view, and inspector screens
at 390px and 1440px, plus loading, empty, and error states. PNGs are attached to
the Playwright results under `test-results/design-*`; review them visually.
The checks catch viewport overflow, collapsed maps, runtime errors, metric-grid
regressions, and loss of primary-button distinction. They complement visual
review rather than asserting that a passing functional test proves good design.

Run `npm run test:filters` against the built app for the filter/view workflow in
Chromium and WebKit. It checks field containment as well as
viewport overflow, pending edits, save/apply behavior, view selection, reset, and
keyboard dismissal. This complements engine-independent component checks.

`npm run architecture:check` enforces import boundaries, including type imports,
re-exports, literal dynamic imports, and CSS imports/references. Features cannot
import sibling features; shared helpers cannot hide a dependency on feature
implementations. Reusable styles cannot import the shell, features, or vendor
integrations. It runs as part of `npm run check`.

## Why Effect is central

The server is an Effect application, including HTTP routing and lifetime:

- `Settings`, `Workspace`, `Analytics`, `Genie`, `Lakebase`, `SavedViews`, and
  `TripComments` are typed `Context.Service`s assembled through `Layer`s.
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
  OAuth credentials, statement/acquisition deadlines, and shutdown. `Lakebase`
  lazily shares that pool between the independent `SavedViews` and `TripComments`
  services. Saved views use explicit create/update versions and return conflicts
  for stale writes.
  Pinning updates only its own field. Migration uses a transaction and advisory
  lock; `npm run db:migrate` creates the current tables, indexes, and grants.
  Comment submissions use a stable draft ID so retrying
  after a lost response does not create duplicates; authors come from the server's
  current-viewer identity.
- `NodeRuntime` manages graceful signal shutdown for the HTTP/1.1 server.

The app uses its service principal for shared access. All app viewers can see and
edit shared saved views; per-viewer row-level authorization is not implemented.
Trip comments are shared and append-only through the API. The replicated sample
gets a persisted synthetic `trip_id`; future apps should copy a source primary key
when one exists. See the [interaction design rationale](docs/data-access.md#contextual-workflows).

## Verify

```sh
npm run check          # lint, types, tests, build, HTTP smoke check, packed SQL adapter
npm run test:browser   # offline browser checks against the built app; also required in CI
npm run test:ui        # populated desktop/mobile screenshots and visual layout checks
npm run test:filters   # filter/view workflow in Chromium and WebKit
npm run test:architecture # offline Genie recovery, sidebar/dialog/responsive UI, and service checks
npm run bundle:check   # deployment schema validation without credentials
npm run data:check     # live SQL reconciliation, Lakebase CRUD, Genie + follow-up
npm run data:check:comments # live trip comments, safe retries, and temporary-row cleanup
node scripts/check-deployed.mjs dev  # verify actual hosted APIs and app-identity access
npx playwright install chromium webkit # required once before the browser suites
npm start              # separate terminal, with the configured .env
npm run test:e2e       # real browser checks, no mocked data routes
```

Live checks create and remove a temporary saved view. Browser checks verify filtering,
sorting, pagination, CSV, map rendering, responsive navigation, and saved-view
persistence across reloads. Screenshots and traces go to ignored `test-results/`.

The map hexagons come from warehouse H3 aggregates; the street basemap uses
OpenStreetMap tiles. See [data provenance](client/public/SOURCES.md).

Frontend state lives in a Schema-defined Foldkit model. Messages enter the pure
`update` function, which returns the next model and named Effect commands. URL
navigation, HTTP requests, persistence, clipboard, and downloads run through
commands; browser events use a subscription and the MapLibre/deck.gl map uses a scoped mount.
There are no component-local stores or hook lifecycles. `client/src/main.ts` boots
the runtime, while `app/model.ts`, `app/message.ts`, `app/update.ts`, and the stateless views
can be inspected independently. Run `npm run client:check` to check UI conventions
and `npm run test:browser` to exercise the UI and recovery workflows offline.

Interactive controls use `@foldkit/ui`: Nav for route links, Select for trip
sorting, Tabs for chart metrics, Tooltip for the collapsed sidebar, and Dialog
for modal sheets and editors. Popover owns the saved-view chooser, and DatePicker
owns the bounded calendars. Button, Input,
and Textarea render helpers supply the form controls. Keep their interaction
behavior in Foldkit UI and apply app styling through the components' attribute
bundles. `client:check` rejects
hand-built widget roles.

Architecture and operational details: [docs/data-access.md](docs/data-access.md).
Inspiration: [Databricks vacation rentals template](https://developers.databricks.com/templates/vacation-rentals).
