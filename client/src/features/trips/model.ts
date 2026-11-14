import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const Sort = D.TripSort;
export const CommentDraft = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
export const Model = Schema.Struct({
  trips: request(D.Trips),
  page: Schema.Number,
  sort: Sort,
  selectedTrip: Schema.NullOr(D.Trip),
  comments: request(D.TripComments),
  commentDrafts: Schema.Record(Schema.String, CommentDraft),
  posting: Schema.NullOr(D.TripCommentInput),
  postError: Schema.String,
  posted: Schema.String,
});

export type Model = typeof Model.Type;

export const init = (): Model => ({
  trips: empty,
  page: 1,
  sort: "newest",
  selectedTrip: null,
  comments: empty,
  commentDrafts: {},
  posting: null,
  postError: "",
  posted: "",
});
