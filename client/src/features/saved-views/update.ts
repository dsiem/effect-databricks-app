import { Dialog, Popover } from "@foldkit/ui";
import { Command, type Update } from "foldkit";
import type * as D from "../../../../shared/domain";
import { queryFor } from "../../domain/filters";
import { syncDialog } from "../../lib/dialog";
import type { FeatureUpdate } from "../../lib/feature-update";
import * as SavedViewsCommands from "./commands";
import { Message as M, type Message } from "./messages";
import type { Model } from "./model";

function foldPicker(
  model: Model,
  changed: Update.ReturnWithOutMessage<
    Popover.Model,
    Popover.Message,
    Popover.OutMessage
  >,
): FeatureUpdate<Model, Message, Out> {
  return {
    model: { ...model, picker: changed.model },
    commands: (changed.commands ?? []).map((command) =>
      Command.mapMessage(command, (message) => M.SavedViewsPicker({ message })),
    ),
  };
}

const loadSavedViews = (
  model: Model,
  more = false,
): FeatureUpdate<Model, Message, Out> => ({
  model: {
    ...model,
    savedViews: { ...model.savedViews, loading: true, error: "" },
  },
  commands: [
    SavedViewsCommands.LoadSavedViews({
      cursor: more ? (model.savedViews.data?.nextCursor ?? null) : null,
      pages: more ? 1 : model.savedViewPages,
      more,
    }),
  ],
});
function updateSavedViewsState(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "CloseSavedView":
      return model.editor?.saving
        ? { model }
        : { model: { ...model, editor: null } };
    case "CloseDelete":
      return model.savedViewBusy
        ? { model }
        : { model: { ...model, deleting: null } };
    case "SavedViewDialog":
    case "DeleteDialog": {
      const id = message._tag === "SavedViewDialog" ? "savedView" : "delete";
      const busy =
        id === "savedView" ? model.editor?.saving : model.savedViewBusy;
      if (busy && message.message._tag === "RequestedClose") return { model };
      const changed = Dialog.update(model.dialogs[id], message.message);
      const commands: Command.Command<Message>[] = (changed.commands ?? []).map(
        (command) =>
          Command.mapMessage(command, (message) =>
            id === "savedView"
              ? M.SavedViewDialog({ message })
              : M.DeleteDialog({ message }),
          ),
      );
      // Deletion removes the opener. Restore focus after the dialog releases it.
      if (
        id === "delete" &&
        message.message._tag === "CompletedCloseDialog" &&
        model.picker.isOpen
      )
        commands.push(
          Command.mapMessage(
            Popover.FocusPanel({ id: model.picker.id }),
            (message) => M.SavedViewsPicker({ message }),
          ),
        );
      return {
        model: {
          ...model,
          dialogs: { ...model.dialogs, [id]: changed.model },
          ...(changed.outMessage?._tag === "Closed"
            ? id === "savedView"
              ? { editor: null }
              : { deleting: null }
            : {}),
        },
        commands,
      };
    }
    case "SavedViewsPicker": {
      const changed = Popover.update(model.picker, message.message);
      const folded = foldPicker(model, changed);
      if (changed.outMessage?._tag !== "Opened") return folded;
      const loaded = loadSavedViews(folded.model);
      return {
        ...loaded,
        commands: [...(folded.commands ?? []), ...(loaded.commands ?? [])],
      };
    }
    case "NewSavedView":
      return { model, commands: [SavedViewsCommands.NewSavedView({})] };
    case "CreatedSavedView":
      return {
        model: {
          ...model,
          editor: {
            draft: {
              id: message.id,
              title: "",
              body: "",
              filters: context.filters,
              version: null,
            },
            saving: false,
            error: "",
          },
        },
      };
    case "EditSavedView": {
      const { id, title, body, filters, version } = message.savedView;
      return {
        model: {
          ...model,
          editor: {
            draft: { id, title, body, filters, version },
            saving: false,
            error: "",
          },
        },
      };
    }
    case "SavedViewChanged":
      return {
        model: {
          ...model,
          editor: model.editor
            ? {
                ...model.editor,
                draft: {
                  ...model.editor.draft,
                  [message.field]: message.value,
                },
              }
            : null,
        },
      };
    case "SaveSavedView":
      return !model.editor ||
        model.editor.saving ||
        !model.editor.draft.title.trim()
        ? { model }
        : {
            model: {
              ...model,
              editor: { ...model.editor, saving: true, error: "" },
            },
            commands: [
              SavedViewsCommands.SaveSavedView({ draft: model.editor.draft }),
            ],
          };
    case "SavedViewSaved": {
      const next = {
        ...model,
        editor: message.savedView
          ? null
          : model.editor
            ? { ...model.editor, saving: false, error: message.error }
            : null,
        selection:
          message.savedView &&
          queryFor(message.savedView.filters) === queryFor(context.filters)
            ? {
                id: message.savedView.id,
                title: message.savedView.title,
                filters: message.savedView.filters,
              }
            : model.selection,
        notice: message.savedView
          ? `Saved “${message.savedView.title}”`
          : model.notice,
      };
      return loadSavedViews(next);
    }
    case "LoadSavedViews":
      return model.savedViews.loading
        ? { model }
        : loadSavedViews(model, message.more);
    case "LoadedSavedViews":
      return {
        commands:
          message.more &&
          message.data &&
          !message.data.nextCursor &&
          model.picker.isOpen
            ? [
                Command.mapMessage(
                  Popover.FocusPanel({ id: model.picker.id }),
                  (message) => M.SavedViewsPicker({ message }),
                ),
              ]
            : [],
        model: {
          ...model,
          savedViewPages: message.data
            ? message.more
              ? model.savedViewPages + 1
              : message.pages
            : model.savedViewPages,
          savedViews: {
            loading: false,
            error: message.error,
            data: message.data
              ? {
                  ...message.data,
                  rows: message.more
                    ? [
                        ...(model.savedViews.data?.rows ?? []),
                        ...message.data.rows,
                      ]
                    : message.data.rows,
                }
              : model.savedViews.data,
          },
        },
      };
    case "PinSavedView":
      return model.savedViewBusy
        ? { model }
        : {
            model: { ...model, savedViewBusy: true, savedViewError: "" },
            commands: [
              SavedViewsCommands.PinSavedView({ savedView: message.savedView }),
            ],
          };
    case "DeleteSavedView":
      return {
        model: { ...model, deleting: message.savedView, savedViewError: "" },
      };
    case "ConfirmDelete":
      return !model.deleting || model.savedViewBusy
        ? { model }
        : {
            model: { ...model, savedViewBusy: true },
            commands: [
              SavedViewsCommands.DeleteSavedView({ savedView: model.deleting }),
            ],
          };
    case "MutatedSavedView":
      return loadSavedViews({
        ...model,
        savedViewBusy: false,
        savedViewError: message.error,
        notice: message.removed && !message.error ? "" : model.notice,
        deleting: message.removed && !message.error ? null : model.deleting,
        selection:
          message.removed &&
          !message.error &&
          model.deleting?.id === model.selection?.id
            ? null
            : model.selection,
      });
    case "RestoreView":
      return {
        ...foldPicker(
          {
            ...model,
            selection: {
              id: message.savedView.id,
              title: message.savedView.title,
              filters: message.savedView.filters,
            },
            notice: "",
          },
          Popover.close(model.picker),
        ),
        outMessage: {
          _tag: "RestoreFilters",
          filters: message.savedView.filters,
        },
      };
    case "ClearView":
      return {
        ...foldPicker(
          { ...model, selection: null, notice: "" },
          Popover.close(model.picker),
        ),
        outMessage: { _tag: "RestoreFilters", filters: {} },
      };
  }
}

export type Context = { readonly filters: D.Filters };
export type Out = {
  readonly _tag: "RestoreFilters";
  readonly filters: D.Filters;
};

export function updateSavedViews(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  const result = updateSavedViewsState(model, message, context);
  const savedView = syncDialog(
    result.model.dialogs.savedView,
    result.model.editor !== null,
  );
  const deletion = syncDialog(
    result.model.dialogs.delete,
    result.model.deleting !== null,
  );
  return {
    ...result,
    model: {
      ...result.model,
      dialogs: { savedView: savedView.model, delete: deletion.model },
    },
    commands: [
      ...(result.commands ?? []),
      ...(savedView.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) =>
          M.SavedViewDialog({ message }),
        ),
      ),
      ...(deletion.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) => M.DeleteDialog({ message })),
      ),
    ],
  };
}
