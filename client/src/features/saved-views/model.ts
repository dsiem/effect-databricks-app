import { Schema } from "effect";
import * as D from "../../../../shared/domain";

import { request } from "../../lib/request-state";
export const NoteEditor = Schema.Struct({
  draft: D.NoteInput,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const fields = {
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
};
