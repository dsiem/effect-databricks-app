import { defineView } from "foldkit/submodel";
import { compact, money, number } from "../../lib/format";
import { chart } from "../../ui/chart";
import { icon } from "../../ui/icons";
import {
  type Child,
  card,
  error,
  loading,
  table,
  title,
} from "../../ui/primitives";
import { filtersFromQuery, href, queryFor } from "../filters/query";
import { ask } from "../genie/ask";
import { MetricTabs } from "./metric-tabs";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";
import type { ViewModel as Model } from "./view-model";

function overview(h: H, model: Model): Child[] {
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
                                    (context, question) =>
                                      M.OpenGenie({ context, question }),
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
                              chart(h, {
                                kind: "area",
                                title: dailyTitle,
                                data: daily.map((row) => ({
                                  label: row.day.slice(5),
                                  value: row[series],
                                })),
                                formatValue:
                                  series === "revenue"
                                    ? (value) => money(value, 2)
                                    : number,
                                formatTick:
                                  series === "revenue" ? money : compact,
                              }),
                            ],
                          ),
                        ],
                      ),
                  },
                }),
                h.div(
                  [h.Class("chart-footer")],
                  [
                    h.span([], ["NYC yellow taxis"]),
                    h.span([], [`${daily.length} days with recorded trips`]),
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
                      (context, question) => M.OpenGenie({ context, question }),
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
                chart(h, {
                  kind: "bar",
                  title: "Trips by pickup hour",
                  data: hourly.map((row) => ({
                    label: `${row.hour}:00`,
                    value: row.trips,
                  })),
                }),
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
                          (context, question) =>
                            M.OpenGenie({ context, question }),
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
                table(h, {
                  caption: "Top pickup ZIP codes",
                  headers: [
                    "Pickup ZIP",
                    "Trips",
                    "Fare revenue",
                    "Avg. fare",
                    "Explore",
                  ],
                  rows: zones.slice(0, 5).map((zone) => ({
                    key: zone.zip,
                    cells: [
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
                    ],
                  })),
                }),
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
                      (context, question) => M.OpenGenie({ context, question }),
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

export const overviewView = defineView<Model, typeof M.Type>((model, h) =>
  h.div([h.Class("contents")], overview(h, model)),
);
