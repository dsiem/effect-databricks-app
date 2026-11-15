import { Dialog, Popover } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const SavedViewEditor = Schema.Struct({
  draft: D.SavedViewInput,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const Model = Schema.Struct({
  dialogs: Schema.Struct({ savedView: Dialog.Model, delete: Dialog.Model }),
  savedViews: request(D.SavedViewsPage),
  savedViewPages: Schema.Number,
  picker: Popover.Model,
  editor: Schema.NullOr(SavedViewEditor),
  deleting: Schema.NullOr(D.SavedView),
  savedViewBusy: Schema.Boolean,
  savedViewError: Schema.String,
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
    savedView: Dialog.init({
      id: "saved-view",
      focusSelector: "#saved-view-title",
    }),
    delete: Dialog.init({ id: "delete-saved-view", focusSelector: "button" }),
  },
  savedViews: empty,
  savedViewPages: 1,
  picker: Popover.init({
    id: "saved-views-picker",
    contentFocus: true,
    isModal: true,
  }),
  editor: null,
  deleting: null,
  savedViewBusy: false,
  savedViewError: "",
  selection: null,
  notice: "",
});
