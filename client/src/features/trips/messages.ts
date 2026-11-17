import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
import { CommentDraft, Sort } from "./model";

export const messages = {
  CloseTrip: {},
  ResetTrips: {},
  InspectorDialog: { message: Dialog.Message },
  LoadedTrips: {
    generation: Schema.Int,
    data: Schema.NullOr(D.Trips),
    error: Schema.String,
  },
  SetPage: { page: Schema.Number },
  SortTrips: { sort: Sort },
  InspectTrip: { trip: D.TripSnapshot },
  InspectComments: { trip: D.TripSnapshot },
  LoadedCommentCounts: {
    version: Schema.Number,
    data: Schema.NullOr(D.TripCommentCounts),
    error: Schema.String,
  },
  LoadComments: { more: Schema.Boolean },
  LoadedComments: {
    tripId: Schema.String,
    generation: Schema.Int,
    data: Schema.NullOr(D.TripComments),
    error: Schema.String,
    more: Schema.Boolean,
  },
  CommentChanged: { body: Schema.String },
  CreatedCommentDraft: { tripId: Schema.String, draft: CommentDraft },
  PostComment: {},
  PostedComment: { input: D.TripCommentInput, error: Schema.String },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
