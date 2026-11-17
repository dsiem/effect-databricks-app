import { defineView } from "foldkit/submodel";
import { ask } from "../../domain/analysis";
import { compact, money, number } from "../../lib/format";
import { activityColors } from "../../lib/map-colors";
import {
  badge,
  button,
  type Child,
  card,
  error,
  title,
} from "../../ui/primitives";
import { gpsContext } from "./context";
import { dataKey, frameKey, type Model } from "./model";
import { GpsMount, gpsHostId, type MapData } from "./mount";
import { EndpointTabs } from "./tabs";
import { type H, Message as M } from "./view-messages";

export type ViewModel = Model & Pick<MapData, "query" | "filters">;
function gpsMap(h: H, model: ViewModel): Child[] {
  const heading = title(
    h,
    "Trip hotspots",
    "See where journeys begin and end, beyond ZIP boundaries.",
    [badge(h, "NYC yellow taxis")],
  );
  const activity = model.activity;
  if (activity.error || model.mapError)
    return [heading, error(h, activity.error || model.mapError, M.Reload())];
  const data = activity.data ?? {
    endpoint: model.endpoint,
    matchingTrips: 0,
    locatedTrips: 0,
    shownTrips: 0,
    totalCells: 0,
    loaded: 0,
    truncated: false,
    cells: [],
    queriedAt: "",
  };
  const selected = model.selectedCell;
  const endpoint = model.endpoint === "pickup" ? "pickups" : "drop-offs";
  const ready =
    !activity.loading &&
    model.renderedKey ===
      frameKey(model.query, model.endpoint, model.selected, model.revision);
  const metric = (label: string, value: string) =>
    h.div(
      [],
      [
        h.dt([h.Class("muted text-xs")], [label]),
        h.dd([h.Class("gps-value")], [value]),
      ],
    );
  const analysis = gpsContext(model);
  return [
    heading,
    h.div(
      [h.Class("gps-layout")],
      [
        card(
          h,
          [
            h.submodel({
              slotId: "gps-endpoint",
              view: EndpointTabs.view,
              model: model.endpointTabs,
              toParentMessage: (message) => M.GpsTabs({ message }),
              viewInputs: {
                tabs: ["pickup", "dropoff"],
                selectedValue: model.endpoint,
                ariaLabel: "GPS endpoint",
                toView: ({ tablist, tabs, activeIndex }) =>
                  h.div(
                    [],
                    [
                      h.div(
                        [h.Class("panel-header border-b")],
                        [
                          h.div(
                            [],
                            [
                              h.h2(
                                [],
                                [
                                  model.endpoint === "pickup"
                                    ? "Where journeys begin"
                                    : "Where journeys end",
                                ],
                              ),
                              h.p(
                                [h.Class("muted text-xs mt-1")],
                                ["Select an area to explore its trips."],
                              ),
                            ],
                          ),
                          h.div(
                            [h.Class("flex items-center gap-3")],
                            [
                              h.div(
                                [...tablist, h.Class("tabs")],
                                tabs.map((tab) =>
                                  h.button(
                                    [...tab.tab, h.Class("tab")],
                                    [
                                      tab.value === "pickup"
                                        ? "Pickups"
                                        : "Drop-offs",
                                    ],
                                  ),
                                ),
                              ),
                              ask(
                                h,
                                (context, question) =>
                                  M.Analyze({ context, question }),
                                "Ask Genie about trip hotspots",
                                analysis,
                                "Explain the spatial pattern and the selected area, including any limits of this map.",
                              ),
                            ],
                          ),
                        ],
                      ),
                      h.div(
                        [
                          ...(tabs[activeIndex]?.panel ?? []),
                          h.Class("relative"),
                          h.AriaBusy(activity.loading),
                        ],
                        [
                          h.div(
                            [
                              h.Key(gpsHostId),
                              h.Id(gpsHostId),
                              h.Class("map-panel gps-panel"),
                              h.Role("region"),
                              h.AriaLabel(`GPS ${endpoint} density map`),
                              h.DataAttribute("gps-ready", String(ready)),
                              h.DataAttribute(
                                "gps-key",
                                ready
                                  ? dataKey(model.query, model.endpoint)
                                  : "",
                              ),
                              h.OnMount(
                                GpsMount({
                                  query: model.query,
                                  filters: model.filters,
                                  endpoint: model.endpoint,
                                  revision: model.revision,
                                  key: frameKey(
                                    model.query,
                                    model.endpoint,
                                    model.selected,
                                    model.revision,
                                  ),
                                  loading: activity.loading,
                                  selected: model.selected,
                                }),
                              ),
                            ],
                            [],
                          ),
                          ...(activity.loading
                            ? [
                                h.div(
                                  [h.Class("map-updating"), h.Role("status")],
                                  [`Updating ${endpoint}…`],
                                ),
                              ]
                            : []),
                        ],
                      ),
                    ],
                  ),
              },
            }),
            h.div(
              [h.Class("panel-footer border-t gps-legend")],
              [
                h.span([], ["Nearby GPS locations grouped into small areas"]),
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
        h.aside(
          [
            h.Class("gps-insights"),
            h.AriaLabel("GPS map insights"),
            h.AriaBusy(activity.loading),
          ],
          activity.loading
            ? [
                card(
                  h,
                  [h.p([h.Class("muted text-sm")], ["Updating trip map…"])],
                  "p-5",
                ),
              ]
            : [
                card(
                  h,
                  [
                    h.p([h.Class("muted text-xs")], [`Recorded ${endpoint}`]),
                    h.p([h.Class("gps-total")], [compact(data.locatedTrips)]),
                    h.p(
                      [h.Class("muted text-xs mt-2")],
                      [
                        `${number(data.matchingTrips - data.locatedTrips)} trips have no usable ${model.endpoint === "pickup" ? "pickup" : "drop-off"} GPS in the NYC region.`,
                      ],
                    ),
                    ...(data.truncated
                      ? [
                          h.p(
                            [h.Class("muted text-xs mt-2")],
                            [
                              `Showing the ${number(data.loaded)} busiest of ${number(data.totalCells)} areas, covering ${number(data.shownTrips)} locations.`,
                            ],
                          ),
                        ]
                      : []),
                  ],
                  "p-5",
                ),
                card(
                  h,
                  selected
                    ? [
                        h.div(
                          [
                            h.Class(
                              "flex items-center justify-between gap-2 mb-4",
                            ),
                          ],
                          [
                            h.h2([], ["Selected area"]),
                            button(h, {
                              label: "Clear",
                              onClick: M.GpsSelect({ id: null }),
                              variant: "ghost",
                            }),
                          ],
                        ),
                        h.p(
                          [h.Class("muted text-xs mb-4")],
                          [
                            selected.zip
                              ? `Common ZIP area ${selected.zip}`
                              : "Outside ZIP-area coverage",
                          ],
                        ),
                        h.dl(
                          [h.Class("gps-metrics")],
                          [
                            metric("Trips", number(selected.trips)),
                            metric("Average fare", money(selected.avg_fare, 2)),
                            metric(
                              "Average distance",
                              `${selected.avg_distance.toFixed(1)} mi`,
                            ),
                            metric(
                              "Area center",
                              `${selected.latitude.toFixed(3)}, ${selected.longitude.toFixed(3)}`,
                            ),
                          ],
                        ),
                        h.p(
                          [h.Class("muted text-xs mt-4")],
                          [
                            "Fare excludes tips and tolls. This area can span more than one ZIP code.",
                          ],
                        ),
                      ]
                    : [
                        h.h2([], ["Explore an area"]),
                        h.p(
                          [h.Class("muted text-sm mt-2")],
                          [
                            "Select a hexagon on the map, or choose one of the busiest areas below.",
                          ],
                        ),
                      ],
                  "p-5",
                ),
                card(
                  h,
                  [
                    h.h2([], ["Busiest areas"]),
                    h.div(
                      [h.Class("mt-3")],
                      data.cells
                        .slice(0, 5)
                        .map((cell, index) =>
                          h.button(
                            [
                              h.Key(cell.id),
                              h.Class("gps-area"),
                              h.OnClick(M.GpsSelect({ id: cell.id })),
                              h.AriaPressed(String(cell.id === model.selected)),
                              h.AriaLabel(
                                `Area ${index + 1}, ${number(cell.trips)} ${endpoint}`,
                              ),
                            ],
                            [
                              h.span([h.Class("rank")], [String(index + 1)]),
                              h.span(
                                [h.Class("gps-area-label")],
                                [
                                  h.span(
                                    [],
                                    [
                                      cell.zip
                                        ? `Near ${cell.zip}`
                                        : "Outside ZIP coverage",
                                    ],
                                  ),
                                  h.small(
                                    [h.Class("muted")],
                                    [
                                      `${cell.latitude.toFixed(3)}, ${cell.longitude.toFixed(3)}`,
                                    ],
                                  ),
                                ],
                              ),
                              h.span(
                                [h.Class("text-sm font-semibold")],
                                [compact(cell.trips)],
                              ),
                            ],
                          ),
                        ),
                    ),
                    ...(data.locatedTrips === 0
                      ? [
                          h.p(
                            [h.Class("muted text-sm mt-2")],
                            ["No recorded GPS locations match these filters."],
                          ),
                        ]
                      : []),
                  ],
                  "p-5",
                ),
                h.p(
                  [h.Class("muted text-xs")],
                  [
                    "Dates and ZIP filters apply to pickups, including when viewing drop-offs. Locations are recorded endpoints, not driving routes.",
                  ],
                ),
              ],
        ),
      ],
    ),
  ];
}
export const gpsMapView = defineView<ViewModel, typeof M.Type>((model, h) =>
  h.div([h.Class("contents")], gpsMap(h, model)),
);
