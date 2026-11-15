# GPS map comparison

Compared three working MapLibre/deck.gl prototypes with the same January–February
2016 cohort, at city and street zoom, with hover inspection and mobile layout.
Run `npm run maps:compare` to export the real cohort, then serve the study with
`npx vite --config design/maps/vite.config.ts`. `scripts/check-map-prototypes.mjs`
checks rendering, controls and aggregate reconciliation and captures the views.

| Direction                      | Evidence from the prototype                                                                                                                                            | Decision                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Individual GPS points          | 10,539 real sampled pickups reveal Manhattan's street grid. Dense places overplot, and a sample cannot give exact area demand.                                         | Useful for trip-level exploration; omit from this map.                                                         |
| Density cells                  | All 21,821,803 valid pickups reconcile across 2,419 resolution-8 cells. City patterns are clear and hover gives exact counts. Coarse cells hide detail at street zoom. | Choose this direction with finer resolution-10 cells, pickup/drop-off switching and a selected-area inspector. |
| Origin–destination connections | The 80 busiest cross-area pairs show airport connections and cross-river trips. Lines overlap in Manhattan, and the ranked subset omits many journeys.                 | Keep the prototype; defer a dedicated flow explorer.                                                           |

The production GPS view uses the existing date and pickup ZIP filters. Cells
show endpoint counts, not driven routes. GPS exclusions and
any response truncation must stay visible. No million-point browser download,
synthetic locations or ZIP-centroid substitutes are needed.

The deployed resolution-10 maps reconcile all 21,821,803 pickups across 23,578
cells and 21,857,880 drop-offs across 54,610 cells, without truncation. Browser
checks cover pointer/keyboard selection, filters and light/dark themes.
Run `GPS_PREVIEW_TARGET=dev node scripts/check-gps-browser.mjs` for the authenticated
hosted visual check; its credentials are restricted to the app origin.
