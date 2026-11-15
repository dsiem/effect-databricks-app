import { Dialog } from "@foldkit/ui";
import { Option } from "effect";
import { Command } from "foldkit";
import { syncDialog } from "../../lib/dialog";
import type { FeatureUpdate } from "../../lib/feature-update";
import { empty } from "../../lib/request-state";
import * as TripsCommands from "./commands";
import { Message as M, type Message } from "./messages";
import type { Model } from "./model";

function countComments(model: Model): FeatureUpdate<Model, Message, Out> {
  const tripIds = model.trips.data?.rows.map((trip) => trip.trip_id) ?? [];
  const version = model.commentCountsVersion + 1;
  return {
    model: {
      ...model,
      commentCountsVersion: version,
      commentCounts: { ...model.commentCounts, loading: !!tripIds.length },
    },
    commands: tripIds.length
      ? [TripsCommands.LoadCommentCounts({ tripIds, version })]
      : [],
  };
}

const comments = (
  model: Model,
  more = false,
): FeatureUpdate<Model, Message, Out> =>
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
function updateTripsState(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "ResetTrips":
      return {
        model: { ...model, page: 1, sort: "newest", selectedTrip: null },
      };
    case "CloseTrip":
      return { model: { ...model, selectedTrip: null } };
    case "InspectorDialog": {
      const changed = Dialog.update(model.inspectorDialog, message.message);
      return {
        model: {
          ...model,
          inspectorDialog: changed.model,
          selectedTrip:
            changed.outMessage?._tag === "Closed" ? null : model.selectedTrip,
        },
        commands: (changed.commands ?? []).map((command) =>
          Command.mapMessage(command, (message) =>
            M.InspectorDialog({ message }),
          ),
        ),
      };
    }
    case "LoadedTrips":
      return message.key !== context.requestKey
        ? { model }
        : {
            outMessage: { _tag: "SelectionInvalidated" },
            ...countComments({
              ...model,
              commentCounts: empty,
              trips: {
                data: message.data,
                error: message.error,
                loading: false,
              },
            }),
          };
    case "LoadedCommentCounts":
      return message.version !== model.commentCountsVersion
        ? { model }
        : {
            model: {
              ...model,
              commentCounts: {
                data: message.data,
                error: message.error,
                loading: false,
              },
            },
          };
    case "SetPage":
      return {
        model: { ...model, page: message.page },
        outMessage: { _tag: "Reload" },
      };
    case "SortTrips":
      return {
        model: { ...model, page: 1, sort: message.sort },
        outMessage: { _tag: "Reload" },
      };
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
    case "InspectComments":
      return comments({
        ...model,
        inspectorDialog: {
          ...model.inspectorDialog,
          maybeFocusSelector: Option.some(
            message._tag === "InspectComments"
              ? "#trip-comments-heading"
              : "#trip-details-dialog-title",
          ),
        },
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
      if (message.error) return { model: next };
      const counted = countComments(next);
      if (model.selectedTrip?.trip_id !== key) return counted;
      const refreshed = comments(counted.model);
      return {
        ...refreshed,
        commands: [...(counted.commands ?? []), ...(refreshed.commands ?? [])],
      };
    }
  }
}

export type Context = { readonly requestKey: string };
export type Out =
  | { readonly _tag: "Reload" }
  | { readonly _tag: "SelectionInvalidated" };

export function updateTrips(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  const result = updateTripsState(model, message, context);
  const dialog = syncDialog(
    result.model.inspectorDialog,
    result.model.selectedTrip !== null,
  );
  return {
    ...result,
    model: { ...result.model, inspectorDialog: dialog.model },
    commands: [
      ...(result.commands ?? []),
      ...(dialog.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) =>
          M.InspectorDialog({ message }),
        ),
      ),
    ],
  };
}
