import { Dialog, Popover } from "@foldkit/ui";
import { Command, type Update } from "foldkit";
import type * as D from "../../../../shared/domain";
import { queryFor } from "../../domain/filters";
import { syncDialog } from "../../lib/dialog";
import type { FeatureUpdate } from "../../lib/feature-update";
import * as SavedViewsCommands from "./commands";
import { Message as M, type Message } from "./messages";
import type { Model, PickerMode } from "./model";
import { mergeSavedViews, rememberRecent, searchText } from "./picker";

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

function loadSavedViews(
  model: Model,
  more = false,
  debounce = false,
): FeatureUpdate<Model, Message, Out> {
  const version = model.searchVersion + 1;
  return {
    model: {
      ...model,
      searchVersion: version,
      savedViews: {
        ...model.savedViews,
        loading: model.pickerMode._tag !== "Quick",
        error: "",
      },
    },
    commands: [
      SavedViewsCommands.LoadSavedViews.Interrupt(() =>
        M.CompletedCancelLoadSavedViews({ version, more, debounce }),
      ),
    ],
  };
}
function loadShortcuts(
  model: Model,
  removedId: string | null = null,
): FeatureUpdate<Model, Message, Out> {
  const version = model.shortcutVersion + 1;
  return {
    model: {
      ...model,
      shortcutVersion: version,
      shortcuts: { ...model.shortcuts, loading: true, error: "" },
    },
    commands: [
      SavedViewsCommands.LoadSavedViewShortcuts({
        version,
        fallback: model.recentIds,
        removedId,
      }),
    ],
  };
}
function refreshPicker(
  model: Model,
  removedId: string | null = null,
): FeatureUpdate<Model, Message, Out> {
  if (!model.picker.isOpen) return { model };
  const shortcuts = loadShortcuts(model, removedId);
  const results = loadSavedViews(shortcuts.model);
  return {
    ...results,
    commands: [...(shortcuts.commands ?? []), ...(results.commands ?? [])],
  };
}
function changeMode(model: Model, pickerMode: typeof PickerMode.Type) {
  return loadSavedViews(
    {
      ...model,
      pickerMode,
      savedViewPages: 1,
      savedViews: { data: null, loading: false, error: "" },
    },
    false,
    pickerMode._tag === "Search",
  );
}
function invalidatePicker(model: Model) {
  return loadSavedViews({
    ...model,
    pickerMode: { _tag: "Quick" },
    shortcutVersion: model.shortcutVersion + 1,
    shortcuts: { ...model.shortcuts, loading: false },
  });
}
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
      if (
        id === "delete" &&
        message.message._tag === "CompletedCloseDialog" &&
        model.picker.isOpen
      )
        commands.push(SavedViewsCommands.FocusSavedViewSearch());
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
      if (changed.outMessage?._tag === "Closed") {
        const invalidated = invalidatePicker(folded.model);
        return {
          ...invalidated,
          commands: [
            ...(folded.commands ?? []),
            ...(invalidated.commands ?? []),
          ],
        };
      }
      if (changed.outMessage?._tag !== "Opened") return folded;
      const loaded = loadShortcuts({
        ...folded.model,
        pickerMode: { _tag: "Quick" },
      });
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
      return refreshPicker(next);
    }
    case "SavedViewSearchChanged":
      return changeMode(
        model,
        message.value
          ? { _tag: "Search", query: message.value.slice(0, 200) }
          : { _tag: "Quick" },
      );
    case "BrowseSavedViews":
    case "ShowSavedViewShortcuts": {
      const changed = changeMode(model, {
        _tag: message._tag === "BrowseSavedViews" ? "Browse" : "Quick",
      });
      return {
        ...changed,
        commands: [
          ...(changed.commands ?? []),
          SavedViewsCommands.FocusSavedViewSearch(),
        ],
      };
    }
    case "LoadSavedViewShortcuts":
      return loadShortcuts(model);
    case "LoadedSavedViewShortcuts": {
      if (message.version !== model.shortcutVersion || !model.picker.isOpen)
        return { model };
      return {
        model: {
          ...model,
          recentIds: message.data ? message.recentIds : model.recentIds,
          shortcuts: {
            data: message.data,
            loading: false,
            error: message.error,
          },
        },
        commands: message.data
          ? [
              SavedViewsCommands.PersistRecentSavedViews({
                ids: message.recentIds,
              }),
            ]
          : [],
      };
    }
    case "CompletedCancelLoadSavedViews":
      return message.version !== model.searchVersion ||
        !model.picker.isOpen ||
        model.pickerMode._tag === "Quick"
        ? { model }
        : {
            model,
            commands: [
              SavedViewsCommands.LoadSavedViews({
                version: message.version,
                query: searchText(model).trim(),
                more: message.more,
                debounce: message.debounce,
                cursor: message.more
                  ? (model.savedViews.data?.nextCursor ?? null)
                  : null,
                pages: message.more ? 1 : model.savedViewPages,
              }),
            ],
          };
    case "LoadSavedViews":
      return model.savedViews.loading
        ? { model }
        : loadSavedViews(model, message.more);
    case "LoadedSavedViews":
      if (message.version !== model.searchVersion || !model.picker.isOpen)
        return { model };
      return {
        commands:
          message.more &&
          message.data &&
          !message.data.nextCursor &&
          model.picker.isOpen
            ? [SavedViewsCommands.FocusSavedViewSearch()]
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
                    ? mergeSavedViews(
                        model.savedViews.data?.rows ?? [],
                        message.data.rows,
                      )
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
    case "MutatedSavedView": {
      const recentIds =
        message.removed && !message.error
          ? model.recentIds.filter((id) => id !== model.deleting?.id)
          : model.recentIds;
      const refreshed = refreshPicker(
        {
          ...model,
          savedViewBusy: false,
          recentIds,
          savedViewError: message.error,
          notice: message.removed && !message.error ? "" : model.notice,
          deleting: message.removed && !message.error ? null : model.deleting,
          selection:
            message.removed &&
            !message.error &&
            model.deleting?.id === model.selection?.id
              ? null
              : model.selection,
        },
        message.removed && !message.error ? (model.deleting?.id ?? null) : null,
      );
      return {
        ...refreshed,
        commands: [
          ...(refreshed.commands ?? []),
          ...(!model.deleting && model.picker.isOpen
            ? [SavedViewsCommands.FocusSavedViewSearch()]
            : []),
        ],
      };
    }
    case "RestoreView": {
      const recentIds = rememberRecent(model.recentIds, message.savedView.id);
      const invalidated = invalidatePicker({ ...model, recentIds });
      const closed = foldPicker(
        {
          ...invalidated.model,
          selection: {
            id: message.savedView.id,
            title: message.savedView.title,
            filters: message.savedView.filters,
          },
          notice: "",
        },
        Popover.close(model.picker),
      );
      return {
        ...closed,
        commands: [
          ...(closed.commands ?? []),
          ...(invalidated.commands ?? []),
          SavedViewsCommands.RememberRecentSavedView({
            id: message.savedView.id,
            fallback: model.recentIds,
          }),
        ],
        outMessage: {
          _tag: "RestoreFilters",
          filters: message.savedView.filters,
        },
      };
    }
    case "ClearView": {
      const invalidated = invalidatePicker(model);
      const closed = foldPicker(
        { ...invalidated.model, selection: null, notice: "" },
        Popover.close(model.picker),
      );
      return {
        ...closed,
        commands: [...(closed.commands ?? []), ...(invalidated.commands ?? [])],
        outMessage: { _tag: "RestoreFilters", filters: {} },
      };
    }
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
