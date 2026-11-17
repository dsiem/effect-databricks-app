import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { request } from "../../lib/api-client";
import { done, result } from "../../lib/command-result";
import { Idle } from "../../lib/idle";
import { randomUuid } from "../../lib/uuid";
import { downloadCsv, tripCsv } from "./export";
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
    trip: D.TripSnapshot,
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
export const LoadCommentCounts = Command.define("LoadCommentCounts", {
  args: {
    tripIds: Schema.Array(D.TripSnapshot.fields.trip_id),
    version: Schema.Number,
  },
  messages: [M.LoadedCommentCounts],
  execute: ({ tripIds, version }) =>
    result(
      request((client) => client.tripCommentCounts({ query: { tripIds } })),
    ).pipe(Effect.map((value) => M.LoadedCommentCounts({ version, ...value }))),
});
export const CommentDraft = Command.define("CreateCommentDraft", {
  args: { tripId: Schema.String, body: Schema.String },
  messages: [M.CreatedCommentDraft],
  execute: ({ tripId, body }) =>
    Effect.sync(() =>
      M.CreatedCommentDraft({
        tripId,
        draft: { id: randomUuid(), body },
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
        downloadCsv(tripCsv(rows), `taxi-trips-loaded-page-${page}.csv`);
      }),
    ),
});
