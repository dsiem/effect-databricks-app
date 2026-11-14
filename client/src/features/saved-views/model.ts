import { Popover } from "@foldkit/ui";
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
