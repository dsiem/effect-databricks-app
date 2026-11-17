# Map dataset ownership

The map at `/trip-map` loads JSON from `GET /api/trip-map` and owns its bulk dataset inside the mounted component.

## Ownership and rendering

The mount receives query text, pickup/drop-off endpoint, request revision, selected identity, loading state, and render identity. It loads and retains the dataset, aborts superseded requests, and releases resources on replacement or unmount. Foldkit receives counts, at most five cell summaries, and one selected summary. Polygon geometry and the full cell list stay outside the global model. Request and render identities include the revision so a retry cannot accept a previous response for the same filters.

The resource keeps a cell identity index for selection, exposes metadata through `cell(index)`, and supplies `ring(index)` for the selected outline. The renderer passes GeoJSON polygon rings to deck.gl. Picking accepts only valid indices from the cell layer; selection outlines are not pickable. Tooltips, activity colors, selected-cell centering, themes, and endpoint switching use the same resource.

## Scope and memory

The endpoint accepts the existing date, pickup ZIP, and pickup/drop-off query. The application displays at most the 100,000 busiest cells and reports matching, located, and shown trip counts. Intentional application truncation remains distinct from an incomplete warehouse result.

Before retaining a dataset, the browser checks unique cell identities and applies an admission estimate of `4 × JSON bytes + 512 × loaded cells`, capped at 128 MiB. This is an estimate, not a measured heap bound. It excludes GPU allocations and browser overhead, and old and new datasets can overlap briefly during replacement.

## Verification

```sh
npm run check
npx playwright test --config playwright.architecture.config.ts gps-map.spec.ts foldkit.spec.ts explore-context.spec.ts --workers=1
# Read-only checks against the configured warehouse:
npm run data:check:gps
```

Resource tests cover picking, bounded summaries, disposal, duplicate identities, and row budgets. Browser scenarios cover filters, endpoint changes, cancellation, retry, unmounting, tooltips, keyboard selection, themes, and narrow screens.

The Arrow transport and native geometry experiments, including their research and validation artifacts, are preserved on the `experiments/arrow` branch.
