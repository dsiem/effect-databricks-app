import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const Sort = D.TripSort;
export const CommentDraft = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
export const Model = Schema.Struct({
  inspectorDialog: Dialog.Model,
  trips: request(D.Trips),
  page: Schema.Number,
  sort: Sort,
  selectedTrip: Schema.NullOr(D.TripSnapshot),
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
