import type { Update } from "foldkit";
import type { Message } from "../../app/message";
import { type Model, requestKey } from "../../app/model";
import { loadPage } from "../../app/navigation";
import { empty } from "../../app/request-state";
import type { ApiClient } from "../../lib/api-client";
import * as TripsCommands from "./commands";

const comments = (
  model: Model,
  more = false,
): Update.Return<Model, Message, ApiClient> =>
  model.selectedTrip
    ? {
        model: {
          ...model,
          comments: { ...model.comments, loading: true, error: "" },
        },
        commands: [
          TripsCommands.LoadComments({
            trip: model.selectedTrip,
            cursor: more ? (model.comments.data?.nextCursor ?? null) : null,
            more,
          }),
        ],
      }
    : { model };
export function updateTrips(
  model: Model,
  message: Extract<
    Message,
    {
      readonly _tag:
        | "SetPage"
        | "SortTrips"
        | "ExportTrips"
        | "LoadedTrips"
        | "InspectTrip"
        | "LoadComments"
        | "LoadedComments"
        | "CommentChanged"
        | "CreatedCommentDraft"
        | "PostComment"
        | "PostedComment";
    }
  >,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "LoadedTrips":
      return message.key !== requestKey(model)
        ? { model }
        : {
            model: {
              ...model,
              trips: {
                data: message.data,
                error: message.error,
                loading: false,
              },
              genieSelection: null,
            },
          };
    case "SetPage":
      return loadPage({ ...model, page: message.page });
    case "SortTrips":
      return loadPage({
        ...model,
        page: 1,
        sort: message.sort,
      });
    case "ExportTrips":
      return {
        model,
        commands: model.trips.data
          ? [
              TripsCommands.ExportTrips({
                rows: model.trips.data.rows,
                page: model.page,
              }),
            ]
          : [],
      };
    case "InspectTrip":
      return comments({
        ...model,
        selectedTrip: message.trip,
        comments: empty,
        postError: "",
        posted: "",
      });
    case "LoadComments":
      return model.comments.loading ? { model } : comments(model, message.more);
    case "LoadedComments":
      return message.tripId !== model.selectedTrip?.trip_id
        ? { model }
        : {
            model: {
              ...model,
              comments: {
                loading: false,
                error: message.error,
                data: message.data
                  ? {
                      ...message.data,
                      rows: message.more
                        ? [
                            ...(model.comments.data?.rows ?? []),
                            ...message.data.rows,
                          ]
                        : message.data.rows,
                    }
                  : model.comments.data,
              },
            },
          };
    case "CommentChanged": {
      const id = model.selectedTrip?.trip_id;
      if (!id) return { model };
      const draft = model.commentDrafts[id];
      if (!draft || (draft.id && model.posting?.id === draft.id))
        return {
          model: {
            ...model,
            commentDrafts: {
              ...model.commentDrafts,
              [id]: { id: "", body: message.body },
            },
          },
          commands: [
            TripsCommands.CommentDraft({ tripId: id, body: message.body }),
          ],
        };
      return {
        model: {
          ...model,
          commentDrafts: {
            ...model.commentDrafts,
            [id]: { ...draft, body: message.body },
          },
          postError: "",
          posted: "",
        },
      };
    }
    case "CreatedCommentDraft": {
      const existing = model.commentDrafts[message.tripId];
      return {
        model: {
          ...model,
          commentDrafts: {
            ...model.commentDrafts,
            [message.tripId]: {
              id: message.draft.id,
              body: existing?.body ?? message.draft.body,
            },
          },
        },
      };
    }
    case "PostComment": {
      const trip = model.selectedTrip;
      const draft = trip && model.commentDrafts[trip.trip_id];
      if (!trip || !draft?.id || !draft.body.trim() || model.posting)
        return { model };
      const input = { ...draft, trip };
      return {
        model: { ...model, posting: input, postError: "", posted: "" },
        commands: [TripsCommands.PostComment({ input })],
      };
    }
    case "PostedComment": {
      const key = message.input.trip.trip_id;
      const drafts = { ...model.commentDrafts };
      if (
        !message.error &&
        drafts[key]?.id === message.input.id &&
        drafts[key]?.body === message.input.body
      )
        delete drafts[key];
      const next = {
        ...model,
        posting: null,
        commentDrafts: drafts,
        posted: message.error ? "" : key,
        postError: model.selectedTrip?.trip_id === key ? message.error : "",
      };
      return message.error || model.selectedTrip?.trip_id !== key
        ? { model: next }
        : comments(next);
    }
  }
}
