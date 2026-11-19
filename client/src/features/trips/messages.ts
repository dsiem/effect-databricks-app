import { Notice } from "../../lib/request-state";
import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
import { Sort } from "./model";

export const messages = {
  CloseTrip: {},
  ResetTrips: {},
  InspectorDialog: { message: Dialog.Message },
  LoadedTrips: {
    generation: Schema.Int,
    data: Schema.NullOr(D.Trips),
    error: Notice,
  },
  NextPage: {},
  PreviousPage: {},
  SortTrips: { sort: Sort },
  InspectTrip: { trip: D.TripSnapshot },
  InspectComments: { trip: D.TripSnapshot },
  LoadedCommentCounts: {
    version: Schema.Number,
    data: Schema.NullOr(D.TripCommentCounts),
    error: Notice,
  },
  LoadComments: { more: Schema.Boolean },
  LoadedComments: {
    tripId: Schema.String,
    generation: Schema.Int,
    data: Schema.NullOr(D.TripComments),
    error: Notice,
    more: Schema.Boolean,
  },
  CommentChanged: { body: Schema.String },
  PostComment: {},
  PostedComment: { input: D.TripCommentInput, error: Notice },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
