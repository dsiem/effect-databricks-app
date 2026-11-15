import { Dialog, Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";

export const messages = {
  CloseNote: {},
  CloseDelete: {},
  NoteDialog: { message: Dialog.Message },
  DeleteDialog: { message: Dialog.Message },
  SavedViewsPicker: { message: Popover.Message },
  ClearView: {},
  NewNote: {},
  CreatedNote: { id: Schema.String },
  EditNote: { note: D.Note },
  NoteChanged: {
    field: Schema.Literals(["title", "body"]),
    value: Schema.String,
  },
  SaveNote: {},
  SavedNote: { note: Schema.NullOr(D.Note), error: Schema.String },
  LoadNotes: { more: Schema.Boolean },
  LoadedNotes: {
    data: Schema.NullOr(D.Notes),
    error: Schema.String,
    more: Schema.Boolean,
    pages: Schema.Number,
  },
  PinNote: { note: D.Note },
  DeleteNote: { note: D.Note },
  ConfirmDelete: {},
  MutatedNote: { removed: Schema.Boolean, error: Schema.String },
  RestoreView: { note: D.Note },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
