# JSON explorer boundary

The grid is available at `/trips-preview`, with the same `from`, `to`, pickup `zip`, and `sort` query parameters as `/trips`. Both routes use JSON. The existing route remains the production workflow while device, browser, and accessibility validation continues.

## Dataset contract

`POST /api/trip-datasets` takes `{ filters, sort }`. Its schema-version-1 response includes canonical query identity, dataset identity, an opaque snapshot token, loaded and total matching counts, budgets, and lean trip summaries. Scope is a discriminated union:

- `complete`: every matching row is present, IDs are unique, and both budgets pass. An empty result is complete. A downloaded prefix cannot satisfy the schema.
- `server-window`: an intentional window targeting 5,000 rows, its absolute start, and signed previous/next continuations. It is never locally filtered or sorted as though it were complete.

Opening a dataset reads the current Delta version. Counts, summaries, continuations, and inspector details all use that version. Continuations include the query, primary ordering value, trip ID, position, and total. They are authenticated, expire after 30 minutes, and are invalidated by a service restart. Expired snapshots and unavailable Delta history require a query reload. Horizontal replicas would need a shared signing key before this continuation scheme is used across replicas.

`POST /api/trip-datasets/window` accepts `{ query, cursor }` and rejects mismatched queries or altered cursors. Scrolling is sequential in both directions; it does not offer arbitrary row jumps or an estimated scrollbar over unloaded server rows. Arbitrary jumps would require an indexed materialized result. `POST /api/trip-datasets/detail` accepts `{ tripId, snapshot }` and returns the enriched trip separately. The inspector retains that one trip snapshot for comments after window eviction.

## Shared operation semantics

The configured table must follow the seeded taxi snapshot contract in `jobs/seed-trip-snapshot.sql`: unique persisted UUID trip IDs, finite analytical measures, and microsecond `TIMESTAMP_NTZ` source timestamps. These source timestamps describe recorded wall-clock times; they are not UTC instants. The response uses `yyyy-MM-dd HH:mm:ss.SSSSSS` and never passes through JavaScript `Date` or timezone conversion. The grid shows seconds and retains the full value in the cell title and inspector. The [Databricks TIMESTAMP_NTZ definition](https://docs.databricks.com/aws/en/sql/language-manual/data-types/timestamp-ntz-type) describes the source type.

Pickup date filters include both boundary days. ZIP filtering is exact, using binary comparison. Unknown ZIPs remain null in summaries, fail an explicit ZIP filter, and display as “Unknown”; the inspector adapts them to the existing trip/comment contract. Null or non-finite analytical measures and malformed timestamps are schema failures rather than silently invented zeros.

All sorts descend by their primary value: pickup timestamp, fare, or distance. Equal values sort by UUID ascending under explicit `UTF8_BINARY` collation. Timestamp strings have fixed-width microsecond precision; IDs and ZIPs are ASCII, so the worker's lexical comparisons match SQL without a locale-sensitive comparator. SQL and local queries share their public definitions in `shared/trip-dataset.ts`; tests execute the SQL predicates and ordering independently in embedded Postgres with dialect spelling translated.

A complete dataset can answer a new query locally only when its filter scope contains the new scope. Expanding a date range, removing a constrained ZIP, or otherwise leaving the downloaded scope opens a new server dataset. Sorting preserves the same matching population. Reload explicitly obtains a fresh snapshot even if a complete result is cached.

## Resource ownership and limits

Foldkit owns applied query intent, status/counts, and selection. The mounted native table owns its viewport, focus, row nodes, and scroll state. A lazy-loaded JSON worker owns requests, complete datasets, filtered/sorted row indices, or a sliding cursor window. This uses the existing GPS mount pattern.

The server and worker enforce `EXPLORER_ROW_BUDGET` (default 20,000; maximum 100,000) and `EXPLORER_BYTE_BUDGET` (default 33,554,432; maximum 268,435,456). Defaults are evaluation settings, not validated device limits. The byte charge is four times UTF8 JSON summary bytes, reserving space for retained rows, indices, and temporary copies. It is a conservative admission estimate, **not a measurement or guarantee of total browser heap**; runtime overhead and actual peak heap still need device measurement.

Initial and subsequent server windows use one stable size: the minimum of 5,000, the configured row budget, and the byte budget divided by a conservative 2 KiB row reservation, rounded down with at least one row attempted. This reservation allows for retained JSON summaries and temporary allocations; it is a sizing policy rather than a heap guarantee. Actual JSON byte charges remain checked, and a window that cannot fit fails explicitly. The worker retains at most three windows and evicts additional windows to satisfy both aggregate budgets. At normal budgets this means up to 15,000 cached rows, while only the bounded visible window reaches the renderer. When a budget is too small for automatic viewport prefetch, continuation buttons remain available instead of repeatedly downloading pages without user scrolling.

The worker sends at most 80 rows per viewport message. The renderer mounts only that window, overscan included, plus at most one focused row. Placeholder rows preserve native table geometry and declare absolute row indices and total row count. Headers stay sticky; touch targets remain at least 44 pixels, and narrow layouts hide secondary columns. Keyboard arrows and Page Up/Down move inspection focus through virtual rows.

Query replacement aborts the preceding request and rejects obsolete generations in the worker and stale keys in Foldkit. Existing displayed rows stay visible but disabled during replacement. A failed replacement leaves an explicit error and reload control. Worker failure clears busy state; reload creates a new worker. Unmount terminates the worker and releases requests, observers, listeners, row caches, and subscriptions.

## Verification and remaining release work

Use the Node version in `.nvmrc` (22.23.5).

```sh
npm run test:trip-grid
npm run check
# Existing surrounding explorer and inspector behavior:
npx playwright test --config playwright.architecture.config.ts foldkit.spec.ts trip-comments.spec.ts filter-workflow.spec.ts filter-validation.spec.ts --workers=1
```

The focused checks cover SQL/local agreement with ties, null ZIPs, empty results and microsecond date boundaries; row and byte fallback; incomplete-response rejection; signed bidirectional continuations; generated HTTP-client contracts; JSON model preservation; bounded worker messages and DOM rows; deep-scroll eviction; stale queries; keyboard inspection and focus return; narrow screens with enlarged text; worker restart and disposal.

Device and browser measurements, assistive-technology validation, and rollout remain open. The production `/trips` route is retained until those release checks are complete. The Arrow experiments and their research are preserved on the `experiments/arrow` branch.

## Surrounding explorer workflow

The worker fetches comment counts for its current window, including overscan, in requests of at most 25 IDs. Its cache retains at most 240 IDs and disappears when the worker terminates. A successful post invalidates the cache even if the inspector has moved to another trip. Reload also invalidates counts. Obsolete query generations and pre-post count responses cannot overwrite refreshed counts. Failed or missing counts remain unavailable rather than displaying an invented zero. The selected enriched trip remains the snapshot sent with comments.

The preview offers two summary CSV scopes:

- **Export complete matching result** is available only when the entire matching result fits the dataset budget. It exports the current worker filter and sort order, not the original downloaded population. The filename ends in `complete-result.csv`.
- **Export visible subset** exports only the current window, including overscan, with at most 80 rows. It remains available for server-operated results. The filename ends in `visible-subset.csv`.

Server mode does not expose a full-result export. Adding that action requires a server export operation rather than looping through cursor windows in the browser. Complete-result CSV generation stays in the worker, and bulk export messages bypass Foldkit. Visible export uses the renderer’s current bounded rows so a pending scroll response cannot change the exported subset. Summary CSV does not claim to include the separately fetched inspector detail columns. The existing paged route explicitly names its export **Export loaded page subset** and includes `loaded-page` in its filename.

Genie context includes applied query filters, sort, result scope, matching and retained counts, selected trip identity, and at most five current window summaries. Snapshot identity and visible position accompany the sample. Replacement queries discard the old context sample before loading, and stale window events are rejected. The map context similarly includes applied filters, endpoint, cell and trip counts, selected cell identity, and at most five area summaries without geometry.

`from`, `to`, and pickup `zip` define global scope for the overview, trips, and map. The explorer's only current table refinement is `sort`, with values `newest`, `fare`, or `distance`; it changes ordering without changing matching counts. Both explorer routes restore sort on reload and browser history navigation. The default is `newest`, and invalid sort values use that default. Applying global filters preserves the active explorer sort.

Saved views store global date and ZIP filters only. Opening a saved view or **All trips** removes table sort from the URL and restores latest-pickup ordering. Selection, viewport position, cursor, and downloaded rows are transient and are not saved. The saved-view editor states this scope. Route replacement and removal of page-only state remain deferred until release validation is complete.
