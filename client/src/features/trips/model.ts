import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
import { GridStatus, GridWindow } from "./grid-protocol";
export const Sort = D.TripSort;
export const CommentDraft = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
export const Model = Schema.Struct({
  gridKey: Schema.String,
  gridRevision: Schema.Number,
  gridStatus: GridStatus,
  gridWindow: Schema.NullOr(GridWindow),
  inspectorDialog: Dialog.Model,
  trips: request(D.Trips),
  page: Schema.Number,
  sort: Sort,
  selectedTrip: Schema.NullOr(D.Trip),
  comments: request(D.TripComments),
  commentCounts: request(D.TripCommentCounts),
  commentCountsVersion: Schema.Number,
  commentDrafts: Schema.Record(Schema.String, CommentDraft),
  posting: Schema.NullOr(D.TripCommentInput),
  postError: Schema.String,
  posted: Schema.String,
});

export type Model = typeof Model.Type;

export const init = (): Model => ({
  gridWindow: null,
  gridKey: "",
  gridRevision: 0,
  gridStatus: {
    key: "",
    loading: false,
    error: "",
    scope: "none",
    total: 0,
    loaded: 0,
  },
  inspectorDialog: Dialog.init({
    id: "trip-details",
    focusSelector: "#trip-details-dialog-title",
  }),
  trips: empty,
  page: 1,
  sort: "newest",
  selectedTrip: null,
  comments: empty,
  commentCounts: empty,
  commentCountsVersion: 0,
  commentDrafts: {},
  posting: null,
  postError: "",
  posted: "",
});
