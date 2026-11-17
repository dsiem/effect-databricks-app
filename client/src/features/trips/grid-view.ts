import { Select } from "@foldkit/ui";
import { Schema } from "effect";
import { defineView } from "foldkit/submodel";
import { filtersFromQuery } from "../../domain/filters";
import { button, title } from "../../ui/primitives";
import { gridHostId, TripGridMount } from "./grid-mount";
import { type Model, Sort } from "./model";
import { Message as M } from "./view-messages";

export const tripGridView = defineView<
  Model & { readonly query: string },
  typeof M.Type
>((model, h) => {
  const status = model.gridStatus;
  return h.div(
    [h.Class("trip-grid-preview")],
    [
      title(
        h,
        "Trip explorer preview",
        "Browse all matching trips. Source timestamps retain their recorded wall-clock meaning.",
        [],
      ),
      h.div(
        [h.Class("panel-header")],
        [
          Select.view(
            {
              id: "preview-trip-sort",
              value: model.sort,
              onChange: (sort) =>
                M.SortTrips({ sort: Schema.decodeUnknownSync(Sort)(sort) }),
              toView: ({ select, label }) =>
                h.div(
                  [h.Class("sort-control")],
                  [
                    h.label([...label], ["Sort by"]),
                    h.select(
                      [...select, h.AriaLabel("Sort trips"), h.Class("input")],
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
          h.p(
            [h.Role("status"), h.AriaLive("polite"), h.Class("muted text-sm")],
            [
              status.loading
                ? "Updating matching trips…"
                : status.error
                  ? status.error
                  : `${status.total.toLocaleString()} matching trips · ${status.scope === "complete" ? "Complete result" : "Server scrolling"}`,
            ],
          ),
          button(h, { label: "Reload query", onClick: M.Reload() }),
        ],
      ),
      h.div(
        [
          h.Key(gridHostId),
          h.Id(gridHostId),
          h.Class("trip-grid-host"),
          h.OnMount(
            TripGridMount({
              key: model.gridKey,
              query: {
                filters: filtersFromQuery(model.query) ?? {},
                sort: model.sort,
              },
              countsVersion: model.commentCountsVersion,
              selectedId: model.selectedTrip?.trip_id ?? null,
            }),
          ),
        ],
        [],
      ),
      h.p(
        [h.Class("muted text-sm mt-4")],
        [
          "CSV exports contain trip summaries. Complete-result export includes every matching trip; visible-subset export includes only the current rendered window. Open a trip for details and comments.",
        ],
      ),
    ],
  );
});
