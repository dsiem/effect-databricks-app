import { Select } from "@foldkit/ui";
import { Schema } from "effect";
import { defineView } from "foldkit/submodel";
import { money, number } from "../../lib/format";
import { icon } from "../../ui/icons";
import {
  badge,
  button,
  type Child,
  card,
  error,
  loading,
  table,
  title,
} from "../../ui/primitives";
import type { Model } from "./model";
import { Sort } from "./model";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";

function trips(h: H, model: Model): Child[] {
  const data = model.trips.data;
  const heading = title(
    h,
    "Trip records",
    "Explore individual trips. Open a record to inspect its details and discuss it with your team.",
  );
  if (model.trips.loading) return [heading, loading(h)];
  if (model.trips.error)
    return [heading, error(h, model.trips.error, M.Reload())];
  if (!data) return [heading];
  return [
    heading,
    card(
      h,
      [
        h.div(
          [h.Class("panel-header border-b")],
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
                      h.label(
                        [...label, h.Class("muted text-sm")],
                        ["Sort by"],
                      ),
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
        table(h, {
          caption: "Matching trips",
          headers: [
            "Pickup time",
            "Route · ZIP codes",
            "Drop-off time",
            "Distance",
            "Duration",
            "Fare",
            h.span([h.Class("sr-only")], ["Trip actions"]),
          ],
          rows: data.rows.map((trip) => {
            const count = model.commentCounts.data?.[trip.trip_id];
            const countLabel =
              count === undefined
                ? model.commentCounts.loading
                  ? "Loading comment count"
                  : "Comment count unavailable"
                : `${number(count)} ${count === 1 ? "comment" : "comments"}`;
            return {
              key: trip.trip_id,
              cells: [
                trip.pickup_at,
                `${trip.pickup_zip} → ${trip.dropoff_zip}`,
                trip.dropoff_at,
                `${trip.distance.toFixed(2)} mi`,
                `${trip.duration.toFixed(1)} min`,
                money(trip.fare, 2),
                h.div(
                  [h.Class("trip-row-actions")],
                  [
                    button(h, {
                      label: h.span(
                        [h.Class("trip-comment-count")],
                        [
                          icon(h, "message-square"),
                          count === undefined ? "–" : number(count),
                        ],
                      ),
                      onClick: M.InspectComments({ trip }),
                      className: `trip-comments-button${count ? " has-comments" : ""}`,
                      attributes: [
                        h.Title(`${countLabel} · Open conversation`),
                        h.AriaLabel(
                          `${countLabel} for trip ${trip.pickup_at} from ${trip.pickup_zip} to ${trip.dropoff_zip}`,
                        ),
                      ],
                      variant: "ghost",
                    }),
                    button(h, {
                      label: icon(h, "chevron-right"),
                      onClick: M.InspectTrip({ trip }),
                      attributes: [
                        h.Title("View trip details"),
                        h.AriaLabel(
                          `Details and comments for trip ${trip.pickup_at} from ${trip.pickup_zip} to ${trip.dropoff_zip}`,
                        ),
                      ],
                      className: "trip-details-button",
                      variant: "ghost",
                    }),
                  ],
                ),
              ],
            };
          }),
        }),
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
                button(h, {
                  label: icon(h, "chevron-left"),
                  onClick: M.SetPage({ page: model.page - 1 }),
                  disabled: model.page === 1,
                  attributes: [h.AriaLabel("Previous page")],
                }),
                h.span([], [`Page ${model.page}`]),
                button(h, {
                  label: icon(h, "chevron-right"),
                  onClick: M.SetPage({ page: model.page + 1 }),
                  disabled: model.page * data.pageSize >= data.total,
                  attributes: [h.AriaLabel("Next page")],
                }),
              ],
            ),
          ],
        ),
      ],
      "trip-records",
    ),
    h.p(
      [h.Class("muted text-sm mt-4")],
      [
        "Source timestamps are shown as recorded. Fares are in USD and distances are in miles.",
      ],
    ),
  ];
}

export const tripsView = defineView<Model, typeof M.Type>((model, h) =>
  h.div([h.Class("contents")], trips(h, model)),
);
