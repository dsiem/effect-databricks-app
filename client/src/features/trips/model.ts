import { Schema } from "effect";
import * as D from "../../../../shared/domain";

import { request } from "../../lib/request-state";
export const Sort = D.TripSort;
export const CommentDraft = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
export const fields = {
  trips: request(D.Trips),
  page: Schema.Number,
  sort: Sort,
  selectedTrip: Schema.NullOr(D.Trip),
  comments: request(D.TripComments),
  commentDrafts: Schema.Record(Schema.String, CommentDraft),
  posting: Schema.NullOr(D.TripCommentInput),
  postError: Schema.String,
  posted: Schema.String,
};
