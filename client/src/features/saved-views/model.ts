import { Dialog, Popover } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const NoteEditor = Schema.Struct({
  draft: D.NoteInput,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const Model = Schema.Struct({
  dialogs: Schema.Struct({ note: Dialog.Model, delete: Dialog.Model }),
  notes: request(D.Notes),
  notePages: Schema.Number,
  picker: Popover.Model,
  editor: Schema.NullOr(NoteEditor),
  deleting: Schema.NullOr(D.Note),
  noteBusy: Schema.Boolean,
  noteError: Schema.String,
  selection: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      filters: D.Filters,
    }),
  ),
  notice: Schema.String,
});

export type Model = typeof Model.Type;

export const init = (): Model => ({
  dialogs: {
    note: Dialog.init({ id: "note", focusSelector: "#note-title" }),
    delete: Dialog.init({ id: "delete-note", focusSelector: "button" }),
  },
  notes: empty,
  notePages: 1,
  picker: Popover.init({
    id: "saved-views-picker",
    contentFocus: true,
    isModal: true,
  }),
  editor: null,
  deleting: null,
  noteBusy: false,
  noteError: "",
  selection: null,
  notice: "",
});
