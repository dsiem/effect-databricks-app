import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { request } from "../../lib/api-client";
import { done, result } from "../../lib/command-result";
import { Idle } from "../../lib/idle";
import { Message as M } from "./messages";
export const LoadTrips = Command.define("LoadTrips", {
  args: {
    key: Schema.String,
    filters: D.Filters,
    page: Schema.Number,
    sort: D.TripSort,
  },
  messages: [M.LoadedTrips],
  execute: ({ key, filters, page, sort }) =>
    result(
      request((client) => client.trips({ query: { ...filters, page, sort } })),
    ).pipe(Effect.map((value) => M.LoadedTrips({ key, ...value }))),
});
export const LoadComments = Command.define("LoadComments", {
  args: {
    trip: D.Trip,
    cursor: Schema.NullOr(D.TripCommentCursor),
    more: Schema.Boolean,
  },
  messages: [M.LoadedComments],
  execute: ({ trip, cursor, more }) =>
    result(
      request((client) =>
        client.tripComments({
          query: { trip, ...(cursor ? { cursor } : {}) },
        }),
      ),
    ).pipe(
      Effect.map((value) =>
        M.LoadedComments({ tripId: trip.trip_id, ...value, more }),
      ),
    ),
});
export const CommentDraft = Command.define("CreateCommentDraft", {
  args: { tripId: Schema.String, body: Schema.String },
  messages: [M.CreatedCommentDraft],
  execute: ({ tripId, body }) =>
    Effect.sync(() =>
      M.CreatedCommentDraft({
        tripId,
        draft: { id: crypto.randomUUID(), body },
      }),
    ),
});
export const PostComment = Command.define("PostComment", {
  args: { input: D.TripCommentInput },
  messages: [M.PostedComment],
  execute: ({ input }) =>
    result(request((client) => client.addTripComment({ payload: input }))).pipe(
      Effect.map(({ error }) => M.PostedComment({ input, error })),
    ),
});
export const ExportTrips = Command.define("ExportTrips", {
  args: { rows: Schema.Array(D.Trip), page: Schema.Number },
  messages: [Idle],
  execute: ({ rows, page }) =>
    done(
      Effect.sync(() => {
        const fields = [
          "trip_id",
          "pickup_at",
          "dropoff_at",
          "pickup_zip",
          "dropoff_zip",
          "distance",
          "fare",
          "duration",
        ] as const;
        const csv = [
          fields.join(","),
          ...rows.map((row) =>
            fields
              .map((field) => `"${String(row[field]).replaceAll('"', '""')}"`)
              .join(","),
          ),
        ].join("\r\n");
        const url = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `taxi-trips-page-${page}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }),
    ),
});
