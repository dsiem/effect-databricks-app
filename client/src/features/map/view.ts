import { Button } from "@foldkit/ui";
import { defineView } from "foldkit/submodel";
import { compact, money, number } from "../../lib/format";
import {
  badge,
  type Child,
  card,
  error,
  loading,
  title,
} from "../../ui/primitives";
import { filtersFromQuery, href } from "../filters/query";
import { ask } from "../genie/ask";
import { activityColors, MapMount } from "./mount";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";
import type { ViewModel as Model } from "./view-model";

function pickupMap(h: H, model: Model): Child[] {
  const heading = title(
    h,
    "Pickups by ZIP area",
    "Trip counts aggregated by pickup ZIP code for the selected filters.",
    [badge(h, "New York City")],
  );
  if (model.overview.loading)
    return [heading, loading(h, "Loading pickup activity and NYC boundaries…")];
  if (model.overview.error || model.mapError)
    return [
      heading,
      error(h, model.overview.error || model.mapError, M.LoadPage()),
    ];
  const overview = model.overview.data;
  if (!overview) return [heading];
  const zones = overview.zones;
  const filters = filtersFromQuery(model.query) ?? {};
  return [
    heading,
    h.div(
      [h.Class("map-grid")],
      [
        card(
          h,
          [
            h.div(
              [h.Class("chart-header border-b")],
              [
                h.div(
                  [],
                  [
                    h.h2([], ["Pickup activity"]),
                    h.p(
                      [h.Class("muted text-xs mt-1")],
                      ["Scroll to zoom. Select an area to filter."],
                    ),
                  ],
                ),
                h.div(
                  [h.Class("flex flex-wrap gap-2")],
                  [
                    badge(h, `${compact(model.mappedTrips ?? 0)} mapped trips`),
                    ask(
                      h,
                      (context, question) => M.OpenGenie({ context, question }),
                      "Ask Genie about this map",
                      null,
                      "Explain the pickup distribution in this map and compare the busiest areas.",
                    ),
                  ],
                ),
              ],
            ),
            h.div(
              [
                h.Key(`map-${model.query}`),
                h.Class("map-panel"),
                h.OnMount(MapMount({ zones, query: model.query })),
              ],
              [],
            ),
            h.div(
              [h.Class("chart-footer border-t")],
              [
                "Modified ZIP areas · geographic aggregation",
                h.span(
                  [h.Class("flex items-center gap-1")],
                  [
                    "Fewer",
                    ...activityColors.map((color) =>
                      h.span(
                        [
                          h.Class("h-2 w-5 rounded-sm"),
                          h.Style({ background: color }),
                        ],
                        [],
                      ),
                    ),
                    "More",
                  ],
                ),
              ],
            ),
          ],
          "overflow-hidden",
        ),
        h.div(
          [h.Class("space-y-5")],
          [
            card(
              h,
              [
                h.h2([], ["Pickup ZIP ranking"]),
                h.p(
                  [h.Class("muted text-xs mt-1 mb-4")],
                  ["ZIP codes ranked by recorded trips"],
                ),
                h.ol(
                  [h.AriaLabel("Pickup ZIP ranking")],
                  zones.slice(0, 10).map((zone, index) =>
                    h.li(
                      [h.Key(zone.zip)],
                      [
                        Button.view(
                          {
                            type: "button",
                            onClick: M.PickZip({ zip: zone.zip }),
                            toView: (attributes) =>
                              h.button(
                                [
                                  ...attributes.button,
                                  h.AriaLabel(
                                    `Rank ${index + 1}, ZIP ${zone.zip}, ${number(zone.trips)} trips`,
                                  ),
                                  h.AriaPressed(
                                    String(filters.zip === zone.zip),
                                  ),
                                  h.Class("ranking-row"),
                                ],
                                [
                                  h.span(
                                    [h.Class("rank")],
                                    [String(index + 1)],
                                  ),
                                  h.span(
                                    [h.Class("rank-content")],
                                    [
                                      h.span(
                                        [h.Class("flex justify-between gap-3")],
                                        [
                                          h.span([], [zone.zip]),
                                          h.span(
                                            [h.Class("muted text-xs")],
                                            [number(zone.trips)],
                                          ),
                                        ],
                                      ),
                                      h.span(
                                        [h.Class("rank-bar")],
                                        [
                                          h.span(
                                            [
                                              h.Style({
                                                width: `${(zone.trips / (zones[0]?.trips || 1)) * 100}%`,
                                              }),
                                            ],
                                            [],
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                          },
                          h,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              "p-5",
            ),
            card(
              h,
              [
                h.h2([], ["Geographic coverage"]),
                h.p(
                  [h.Class("muted text-xs leading-5 mt-2")],
                  [
                    "The sample has ZIP codes, not GPS coordinates. NYC Health’s modified ZIP areas group some postal ZIPs together. Trips outside these boundaries are included in totals, but are not drawn.",
                  ],
                ),
                h.p(
                  [h.Class("text-xs font-medium mt-3")],
                  [
                    `${number(Math.max(0, overview.summary.trips - (model.mappedTrips ?? 0)))} trips outside mapped areas`,
                  ],
                ),
                h.a(
                  [
                    h.Href(
                      "https://data.cityofnewyork.us/Health/Modified-Zip-Code-Tabulation-Areas-MODZCTA-/pri4-ifjk",
                    ),
                    h.Class("text-xs underline mt-3 block"),
                  ],
                  ["NYC Health boundary source"],
                ),
                h.a(
                  [h.Href(href("/trips", model.query)), h.Class("btn mt-4")],
                  ["Explore these trips"],
                ),
              ],
              "p-5",
            ),
            ...(filters.zip
              ? [
                  card(
                    h,
                    [
                      h.h2([], [`Pickup ZIP ${filters.zip}`]),
                      h.p(
                        [h.Class("muted text-sm mt-2")],
                        [`${money(overview.summary.revenue)} in fare revenue`],
                      ),
                      h.a(
                        [
                          h.Href(href("/trips", model.query)),
                          h.Class("btn mt-4"),
                        ],
                        ["View trip records"],
                      ),
                    ],
                    "p-5",
                  ),
                ]
              : []),
          ],
        ),
      ],
    ),
  ];
}

export const pickupMapView = defineView<Model, typeof M.Type>((model, h) =>
  h.div([h.Class("contents")], pickupMap(h, model)),
);
