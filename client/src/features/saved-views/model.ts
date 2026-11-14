import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const NoteEditor = Schema.Struct({
  draft: D.NoteInput,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const Model = Schema.Struct({
  notes: request(D.Notes),
  notePages: Schema.Number,
  savedViews: Schema.Boolean,
  editor: Schema.NullOr(NoteEditor),
  deleting: Schema.NullOr(D.Note),
  noteBusy: Schema.Boolean,
  noteError: Schema.String,
  saved: Schema.NullOr(
    Schema.Struct({ title: Schema.String, query: Schema.String }),
  ),
});

export type Model = typeof Model.Type;

export const init = (): Model => ({
  notes: empty,
  notePages: 1,
  savedViews: false,
  editor: null,
  deleting: null,
  noteBusy: false,
  noteError: "",
  saved: null,
});
