import { Popover } from "@foldkit/ui";
import { Command, type Update } from "foldkit";
import type { FeatureUpdate } from "../../lib/feature-update";
import type { Model, PickerMode } from "./browser-model";
import * as SavedViewsCommands from "./commands";
import { Message as M, type Message } from "./messages";
import { mergeSavedViews, rememberRecent, searchText } from "./picker";

function foldPicker(
  model: Model,
  changed: Update.ReturnWithOutMessage<
    Popover.Model,
    Popover.Message,
    Popover.OutMessage
  >,
): FeatureUpdate<Model, Message> {
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
): FeatureUpdate<Model, Message> {
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
): FeatureUpdate<Model, Message> {
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

export type BrowserMessage = Extract<
  Message,
  {
    readonly _tag:
      | "SavedViewsPicker"
      | "SavedViewSearchChanged"
      | "BrowseSavedViews"
      | "ShowSavedViewShortcuts"
      | "LoadSavedViewShortcuts"
      | "LoadedSavedViewShortcuts"
      | "CompletedCancelLoadSavedViews"
      | "LoadSavedViews"
      | "LoadedSavedViews";
  }
>;

export function updateBrowser(
  model: Model,
  message: BrowserMessage,
): FeatureUpdate<Model, Message> {
  switch (message._tag) {
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
  }
}

export function refreshBrowser(
  model: Model,
  removedId: string | null = null,
): FeatureUpdate<Model, Message> {
  const next = removedId
    ? { ...model, recentIds: model.recentIds.filter((id) => id !== removedId) }
    : model;
  if (!next.picker.isOpen) return { model: next };
  const shortcuts = loadShortcuts(next, removedId);
  const results = loadSavedViews(shortcuts.model);
  return {
    ...results,
    commands: [...(shortcuts.commands ?? []), ...(results.commands ?? [])],
  };
}

export function selectBrowser(
  model: Model,
  id: string,
): FeatureUpdate<Model, Message> {
  const recentIds = rememberRecent(model.recentIds, id);
  const closed = clearBrowser({ ...model, recentIds });
  return {
    ...closed,
    commands: [
      ...(closed.commands ?? []),
      SavedViewsCommands.RememberRecentSavedView({
        id,
        fallback: model.recentIds,
      }),
    ],
  };
}

export function clearBrowser(model: Model): FeatureUpdate<Model, Message> {
  const invalidated = invalidatePicker(model);
  const closed = foldPicker(invalidated.model, Popover.close(model.picker));
  return {
    ...closed,
    commands: [...(closed.commands ?? []), ...(invalidated.commands ?? [])],
  };
}
