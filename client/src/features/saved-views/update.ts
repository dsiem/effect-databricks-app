import type * as D from "../../../../shared/domain";
import type { FeatureUpdate } from "../../lib/feature-update";
import * as SavedViewsCommands from "./commands";
import type { Message } from "./messages";
import type { Model } from "./model";

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
export function updateSavedViews(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "OpenSavedViews":
      return loadNotes({ ...model, savedViews: true });
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
        saved: message.note
          ? { title: message.note.title, query: context.query }
          : model.saved,
      };
      return loadNotes(next);
    }
    case "LoadNotes":
      return model.notes.loading ? { model } : loadNotes(model, message.more);
    case "LoadedNotes":
      return {
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
        deleting: message.removed && !message.error ? null : model.deleting,
      });
    case "RestoreView":
      return {
        model: { ...model, savedViews: false },
        outMessage: { _tag: "RestoreFilters", filters: message.filters },
      };
  }
}

export type Context = { readonly filters: D.Filters; readonly query: string };
export type Out = {
  readonly _tag: "RestoreFilters";
  readonly filters: D.Filters;
};
