import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import * as Browser from "./browser-model";
export const SavedViewEditor = Schema.Struct({
  draft: D.SavedViewInput,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const Model = Schema.Struct({
  dialogs: Schema.Struct({ savedView: Dialog.Model, delete: Dialog.Model }),
  browser: Browser.Model,
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
  browser: Browser.init(),
  editor: null,
  deleting: null,
  savedViewBusy: false,
  savedViewError: "",
  selection: null,
  notice: "",
});
