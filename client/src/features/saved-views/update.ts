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

const loadNotes = (
  model: Model,
  more = false,
): FeatureUpdate<Model, Message, Out> => ({
  model: { ...model, notes: { ...model.notes, loading: true, error: "" } },
  commands: [
    SavedViewsCommands.LoadNotes({
      cursor: more ? (model.notes.data?.nextCursor ?? null) : null,
      pages: more ? 1 : model.notePages,
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
    case "CloseNote":
      return model.editor?.saving
        ? { model }
        : { model: { ...model, editor: null } };
    case "CloseDelete":
      return model.noteBusy
        ? { model }
        : { model: { ...model, deleting: null } };
    case "NoteDialog":
    case "DeleteDialog": {
      const id = message._tag === "NoteDialog" ? "note" : "delete";
      const busy = id === "note" ? model.editor?.saving : model.noteBusy;
      if (busy && message.message._tag === "RequestedClose") return { model };
      const changed = Dialog.update(model.dialogs[id], message.message);
      const commands: Command.Command<Message>[] = (changed.commands ?? []).map(
        (command) =>
          Command.mapMessage(command, (message) =>
            id === "note"
              ? M.NoteDialog({ message })
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
            ? id === "note"
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
      const loaded = loadNotes(folded.model);
      return {
        ...loaded,
        commands: [...(folded.commands ?? []), ...(loaded.commands ?? [])],
      };
    }
    case "NewNote":
      return { model, commands: [SavedViewsCommands.NewNote({})] };
    case "CreatedNote":
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
    case "EditNote": {
      const { id, title, body, filters, version } = message.note;
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
    case "NoteChanged":
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
    case "SaveNote":
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
              SavedViewsCommands.SaveNote({ draft: model.editor.draft }),
            ],
          };
    case "SavedNote": {
      const next = {
        ...model,
        editor: message.note
          ? null
          : model.editor
            ? { ...model.editor, saving: false, error: message.error }
            : null,
        selection:
          message.note &&
          queryFor(message.note.filters) === queryFor(context.filters)
            ? {
                id: message.note.id,
                title: message.note.title,
                filters: message.note.filters,
              }
            : model.selection,
        notice: message.note ? `Saved “${message.note.title}”` : model.notice,
      };
      return loadNotes(next);
    }
    case "LoadNotes":
      return model.notes.loading ? { model } : loadNotes(model, message.more);
    case "LoadedNotes":
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
          notePages: message.data
            ? message.more
              ? model.notePages + 1
              : message.pages
            : model.notePages,
          notes: {
            loading: false,
            error: message.error,
            data: message.data
              ? {
                  ...message.data,
                  rows: message.more
                    ? [...(model.notes.data?.rows ?? []), ...message.data.rows]
                    : message.data.rows,
                }
              : model.notes.data,
          },
        },
      };
    case "PinNote":
      return model.noteBusy
        ? { model }
        : {
            model: { ...model, noteBusy: true, noteError: "" },
            commands: [SavedViewsCommands.PinNote({ note: message.note })],
          };
    case "DeleteNote":
      return { model: { ...model, deleting: message.note, noteError: "" } };
    case "ConfirmDelete":
      return !model.deleting || model.noteBusy
        ? { model }
        : {
            model: { ...model, noteBusy: true },
            commands: [SavedViewsCommands.DeleteNote({ note: model.deleting })],
          };
    case "MutatedNote":
      return loadNotes({
        ...model,
        noteBusy: false,
        noteError: message.error,
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
              id: message.note.id,
              title: message.note.title,
              filters: message.note.filters,
            },
            notice: "",
          },
          Popover.close(model.picker),
        ),
        outMessage: { _tag: "RestoreFilters", filters: message.note.filters },
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
  const note = syncDialog(
    result.model.dialogs.note,
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
      dialogs: { note: note.model, delete: deletion.model },
    },
    commands: [
      ...(result.commands ?? []),
      ...(note.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) => M.NoteDialog({ message })),
      ),
      ...(deletion.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) => M.DeleteDialog({ message })),
      ),
    ],
  };
}
