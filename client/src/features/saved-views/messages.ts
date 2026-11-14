import { Schema } from "effect";
import * as D from "../../../../shared/domain";

export const messages = {
  OpenSavedViews: {},
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
  RestoreView: { filters: D.Filters },
};
