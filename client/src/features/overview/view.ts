import { Message as M } from "../../app/message";
import { filtersFromQuery, href, type Model, queryFor } from "../../app/model";
import type { H } from "../../app/view-types";
import { money, number } from "../../lib/format";
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
import { ask } from "../genie/ask";
import { MetricTabs } from "./metric-tabs";

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
