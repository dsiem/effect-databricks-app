import { Button, Select } from "@foldkit/ui";
import { Schema } from "effect";
import type * as D from "../../src/domain";
import { activityColors, MapMount } from "./browser";
import { MetricTabs } from "./components";
import { icon } from "./icons";
import { Message as M } from "./message";
import { filtersFromQuery, href, type Model, queryFor, Sort } from "./model";
import {
  badge,
  button,
  type Child,
  card,
  compact,
  error,
  type H,
  loading,
  money,
  number,
  table,
  title,
} from "./ui";

export const ask = (
  h: H,
  label = "Ask Genie",
  context: D.GenieContext | null = null,
  question: string | null = null,
) =>
  button(h, icon(h, "sparkles"), M.OpenGenie({ context, question }), [
    h.AriaLabel(label),
    h.Attribute("title", label),
  ]);
const chart = (
  h: H,
  data: ReadonlyArray<{ label: string; value: number }>,
  name: string,
  bars = false,
) => {
  const max = Math.max(1, ...data.map((row) => row.value));
  const x = (i: number) => 48 + (i * 620) / Math.max(1, data.length - 1);
  const y = (value: number) => 215 - (value / max) * 180;
  const points = data.map((row, i) => `${x(i)},${y(row.value)}`).join(" ");
  return h.svg(
    [
      h.ViewBox("0 0 700 260"),
      h.Role("img"),
      h.AriaLabel(name),
      h.Class("chart"),
    ],
    [
      h.title([], [name]),
      ...[0, 0.25, 0.5, 0.75, 1].flatMap((fraction) => [
        h.line(
          [
            h.Attribute("x1", "45"),
            h.Attribute("x2", "680"),
            h.Attribute("y1", String(y(max * fraction))),
            h.Attribute("y2", String(y(max * fraction))),
            h.Stroke("var(--border)"),
          ],
          [],
        ),
        h.text(
          [
            h.Attribute("x", "0"),
            h.Attribute("y", String(y(max * fraction) + 4)),
            h.Fill("var(--muted-foreground)"),
            h.Attribute("font-size", "11"),
          ],
          [compact(max * fraction)],
        ),
      ]),
      ...(!bars && data.length
        ? [
            h.polygon(
              [
                h.Attribute(
                  "points",
                  `48,215 ${points} ${x(data.length - 1)},215`,
                ),
                h.Fill("var(--chart-1)"),
                h.Attribute("opacity", "0.12"),
              ],
              [],
            ),
            h.polyline(
              [
                h.Attribute("points", points),
                h.Fill("none"),
                h.Stroke("var(--chart-1)"),
                h.Attribute("stroke-width", "2.5"),
              ],
              [],
            ),
          ]
        : []),
      ...data.map((row, i) =>
        bars
          ? h.rect(
              [
                h.Attribute("x", String(45 + (i * 630) / data.length)),
                h.Attribute("y", String(y(row.value))),
                h.Attribute(
                  "width",
                  String(Math.max(2, 630 / data.length - 5)),
                ),
                h.Attribute("height", String(215 - y(row.value))),
                h.Attribute("rx", "3"),
                h.Fill("var(--chart-2)"),
              ],
              [h.title([], [`${row.label}: ${number(row.value)}`])],
            )
          : h.circle(
              [
                h.Attribute("cx", String(x(i))),
                h.Attribute("cy", String(y(row.value))),
                h.Attribute("r", "4"),
                h.Fill("var(--chart-1)"),
              ],
              [h.title([], [`${row.label}: ${number(row.value)}`])],
            ),
      ),
      ...data
        .filter((_, i) => i % Math.max(1, Math.ceil(data.length / 6)) === 0)
        .map((row) =>
          h.text(
            [
              h.Attribute("x", String(x(data.indexOf(row)))),
              h.Attribute("y", "245"),
              h.Fill("var(--muted-foreground)"),
              h.Attribute("font-size", "12"),
              h.Attribute("text-anchor", "middle"),
            ],
            [row.label],
          ),
        ),
    ],
  );
};

export function overview(h: H, model: Model): Child[] {
  const heading = title(
    h,
    "Trip overview",
    "Trip activity, fares, and pickup patterns at a glance.",
  );
  if (model.overview.loading) return [heading, loading(h)];
  if (model.overview.error)
    return [heading, error(h, model.overview.error, M.LoadPage())];
  const data = model.overview.data;
  if (!data) return [heading];
  const { summary, daily, hourly, zones, queriedAt } = data;
  const series = model.series;
  const dailyTitle =
    series === "trips" ? "Trips by pickup date" : "Fare revenue by pickup date";
  return [
    heading,
    h.div(
      [h.Class("metrics")],
      [
        ["Total trips", number(summary.trips), "Recorded taxi trips"],
        [
          "Total fare revenue",
          money(summary.revenue),
          "USD · excludes tips & tolls",
        ],
        ["Average fare", money(summary.avg_fare, 2), "Per recorded trip"],
        [
          "Average distance",
          `${summary.avg_distance.toFixed(2)} mi`,
          `${summary.avg_duration.toFixed(1)} min average duration`,
        ],
      ].map(([label = "", value = "", detail = ""]) =>
        card(
          h,
          [
            h.h2([h.Class("metric-label")], [label]),
            h.p([h.Class("metric-value")], [value]),
            h.p([h.Class("muted text-xs")], [detail]),
          ],
          "p-6",
        ),
      ),
    ),
    ...(summary.trips === 0
      ? [
          card(
            h,
            [
              "No trips match these filters. Try another date range or pickup ZIP.",
            ],
            "p-10 text-center muted",
          ),
        ]
      : [
          h.div(
            [h.Class("dashboard-grid")],
            [
              card(h, [
                h.submodel({
                  slotId: "daily-metric",
                  view: MetricTabs.view,
                  model: model.metricTabs,
                  toParentMessage: (message) => M.MetricTabs({ message }),
                  viewInputs: {
                    tabs: ["trips", "revenue"],
                    selectedValue: series,
                    ariaLabel: "Daily chart metric",
                    toView: ({ tablist, tabs, activeIndex }) =>
                      h.div(
                        [h.DataAttribute("slot", "tabs")],
                        [
                          h.div(
                            [h.Class("chart-header")],
                            [
                              h.div(
                                [],
                                [
                                  h.h2([], [dailyTitle]),
                                  h.p(
                                    [h.Class("muted text-xs mt-1")],
                                    ["Activity over the selected period"],
                                  ),
                                ],
                              ),
                              h.div(
                                [h.Class("flex flex-wrap gap-2")],
                                [
                                  ask(
                                    h,
                                    `Ask Genie about ${dailyTitle.toLowerCase()}`,
                                    {
                                      page: "overview",
                                      title: dailyTitle,
                                      data: JSON.stringify({
                                        metric: series,
                                        daily,
                                        queriedAt,
                                      }),
                                    },
                                    "Explain the pattern in this chart and highlight any unusual days.",
                                  ),
                                  h.div(
                                    [...tablist, h.Class("tabs")],
                                    tabs.map((tab) =>
                                      h.button(
                                        [
                                          ...tab.tab,
                                          h.Class(
                                            `btn ${tab.isActive ? "selected" : "ghost"}`,
                                          ),
                                        ],
                                        [
                                          tab.value === "trips"
                                            ? "Trips"
                                            : "Revenue",
                                        ],
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          h.div(
                            [...(tabs[activeIndex]?.panel ?? [])],
                            [
                              chart(
                                h,
                                daily.map((row) => ({
                                  label: row.day.slice(5),
                                  value: row[series],
                                })),
                                dailyTitle,
                              ),
                            ],
                          ),
                        ],
                      ),
                  },
                }),
                h.div(
                  [h.Class("chart-footer")],
                  [
                    "NYC yellow taxis",
                    `${daily.length} days with recorded trips`,
                  ],
                ),
              ]),
              card(h, [
                h.div(
                  [h.Class("chart-header")],
                  [
                    h.div(
                      [],
                      [
                        h.h2([], ["Trips by pickup hour"]),
                        h.p(
                          [h.Class("muted text-xs mt-1")],
                          ["Distribution across the day"],
                        ),
                      ],
                    ),
                    ask(
                      h,
                      "Ask Genie about pickup hours",
                      {
                        page: "overview",
                        title: "Trips by pickup hour",
                        data: JSON.stringify({ hourly, queriedAt }),
                      },
                      "Explain this hourly pickup pattern. Which hours stand out?",
                    ),
                  ],
                ),
                chart(
                  h,
                  hourly.map((row) => ({
                    label: `${row.hour}:00`,
                    value: row.trips,
                  })),
                  "Trips by pickup hour",
                  true,
                ),
                h.p(
                  [h.Class("chart-footer")],
                  ["Hours as recorded in the source"],
                ),
              ]),
            ],
          ),
          h.div(
            [h.Class("dashboard-grid")],
            [
              card(h, [
                h.div(
                  [h.Class("chart-header")],
                  [
                    h.div(
                      [],
                      [
                        h.h2([], ["Top pickup ZIP codes"]),
                        h.p(
                          [h.Class("muted text-xs mt-1")],
                          ["Pickup areas ranked by trip volume"],
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("flex flex-wrap gap-2")],
                      [
                        ask(
                          h,
                          "Ask Genie about top pickup ZIP codes",
                          {
                            page: "overview",
                            title: "Top pickup ZIP codes",
                            data: JSON.stringify({
                              topPickupZIPs: zones.slice(0, 5),
                              queriedAt,
                            }),
                          },
                          "Compare these pickup ZIP codes by trip volume and average fare.",
                        ),
                        h.a(
                          [
                            h.Href(href("/map", model.query)),
                            h.Class("btn outline"),
                            h.AriaLabel("View pickup map"),
                          ],
                          [icon(h, "map"), h.span([], ["Pickup map"])],
                        ),
                      ],
                    ),
                  ],
                ),
                table(
                  h,
                  [
                    "Pickup ZIP",
                    "Trips",
                    "Fare revenue",
                    "Avg. fare",
                    "Explore",
                  ],
                  zones.slice(0, 5).map((zone) => [
                    zone.zip,
                    number(zone.trips),
                    money(zone.revenue),
                    money(zone.avg_fare, 2),
                    h.a(
                      [
                        h.Href(
                          href(
                            "/trips",
                            queryFor({
                              ...(filtersFromQuery(model.query) ?? {}),
                              zip: zone.zip,
                            }),
                          ),
                        ),
                        h.AriaLabel(`View trips in ${zone.zip}`),
                        h.Class("btn ghost"),
                      ],
                      [icon(h, "arrow-up-right")],
                    ),
                  ]),
                ),
              ]),
              card(h, [
                h.div(
                  [h.Class("p-6 space-y-4")],
                  [
                    h.span([h.Class("brand-icon")], [icon(h, "sparkles")]),
                    h.h2([], ["Take the next analytical step"]),
                    h.p(
                      [h.Class("muted text-sm leading-6")],
                      [
                        "Ask Genie to explain this view or explore a new angle with the same filters.",
                      ],
                    ),
                    h.p(
                      [h.Class("muted text-sm leading-6")],
                      [
                        "Compare periods, investigate unusual fares, or break down a pattern. Review the results and SQL alongside your dashboard.",
                      ],
                    ),
                    ask(
                      h,
                      "Explore with Genie",
                      null,
                      "Compare weekday and weekend trip activity for this view.",
                    ),
                  ],
                ),
              ]),
            ],
          ),
        ]),
    h.p(
      [h.Class("muted text-xs text-right mt-4")],
      [`Queried ${new Date(queriedAt).toLocaleTimeString()}`],
    ),
  ];
}

export function trips(h: H, model: Model): Child[] {
  const data = model.trips.data;
  const heading = title(
    h,
    "Trip records",
    "Explore individual trips. Open a record to inspect its details and discuss it with your team.",
    [
      ask(
        h,
        "Ask Genie about these trips",
        null,
        "Summarize the visible trips and point out unusual fares or distances.",
      ),
      button(h, "Export this page", M.ExportTrips(), [
        h.Disabled(!data?.rows.length),
      ]),
    ],
  );
  if (model.trips.loading) return [heading, loading(h)];
  if (model.trips.error)
    return [heading, error(h, model.trips.error, M.LoadPage())];
  if (!data) return [heading];
  return [
    heading,
    card(h, [
      h.div(
        [h.Class("chart-header border-b")],
        [
          h.div(
            [h.Class("flex items-center gap-3")],
            [
              h.h2([], ["Matching trips"]),
              badge(h, `${number(data.total)} trips`),
            ],
          ),
          Select.view(
            {
              id: "trip-sort",
              value: model.sort,
              onChange: (value) =>
                M.SortTrips({ sort: Schema.decodeUnknownSync(Sort)(value) }),
              toView: ({ select, label }) =>
                h.div(
                  [h.Class("sort-control")],
                  [
                    h.label([...label, h.Class("muted text-sm")], ["Sort by"]),
                    h.select(
                      [
                        ...select,
                        h.AriaLabel("Sort trips"),
                        h.Class("input sort-select"),
                      ],
                      (["newest", "fare", "distance"] as const).map((sort) =>
                        h.option(
                          [h.Value(sort)],
                          [
                            {
                              newest: "Latest pickup",
                              fare: "Highest fare",
                              distance: "Longest distance",
                            }[sort],
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
            },
            h,
          ),
        ],
      ),
      table(
        h,
        [
          "Pickup time",
          "Route · ZIP codes",
          "Drop-off time",
          "Distance",
          "Duration",
          "Fare",
          "Discussion",
        ],
        data.rows.map((trip) => [
          button(
            h,
            trip.pickup_at,
            M.InspectTrip({ trip }),
            [h.Class("text-left hover:underline")],
            "ghost",
          ),
          `${trip.pickup_zip} → ${trip.dropoff_zip}`,
          trip.dropoff_at,
          `${trip.distance.toFixed(2)} mi`,
          `${trip.duration.toFixed(1)} min`,
          money(trip.fare, 2),
          button(
            h,
            "Comment",
            M.InspectTrip({ trip }),
            [
              h.AriaLabel(
                `Details and comments for trip ${trip.pickup_at} from ${trip.pickup_zip} to ${trip.dropoff_zip}`,
              ),
            ],
            "ghost",
          ),
        ]),
      ),
      ...(!data.rows.length
        ? [
            h.p(
              [h.Class("p-14 muted text-center")],
              ["No trips match these filters."],
            ),
          ]
        : []),
      h.div(
        [h.Class("pagination")],
        [
          h.span(
            [h.Class("muted text-xs")],
            [
              data.total
                ? `${number((model.page - 1) * data.pageSize + 1)}–${number(Math.min(model.page * data.pageSize, data.total))} of ${number(data.total)}`
                : "0 records",
            ],
          ),
          h.div(
            [h.Class("flex items-center gap-3")],
            [
              button(
                h,
                icon(h, "chevron-left"),
                M.SetPage({ page: model.page - 1 }),
                [h.AriaLabel("Previous page"), h.Disabled(model.page === 1)],
              ),
              h.span([], [`Page ${model.page}`]),
              button(
                h,
                icon(h, "chevron-right"),
                M.SetPage({ page: model.page + 1 }),
                [
                  h.AriaLabel("Next page"),
                  h.Disabled(model.page * data.pageSize >= data.total),
                ],
              ),
            ],
          ),
        ],
      ),
    ]),
    h.p(
      [h.Class("muted text-sm mt-4")],
      [
        "Source timestamps are shown as recorded. Fares are in USD and distances are in miles.",
      ],
    ),
  ];
}

export function pickupMap(h: H, model: Model): Child[] {
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
                  [
                    h.Href(href("/trips", model.query)),
                    h.Class("btn outline mt-4"),
                  ],
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
                          h.Class("btn outline mt-4"),
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
