import { Dialog, Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
import { RecentIds, Shortcuts } from "./browser-model";

export const messages = {
  CloseSavedView: {},
  CloseDelete: {},
  SavedViewDialog: { message: Dialog.Message },
  DeleteDialog: { message: Dialog.Message },
  SavedViewsPicker: { message: Popover.Message },
  ClearView: {},
  NewSavedView: {},
  CreatedSavedView: { id: Schema.String },
  EditSavedView: { savedView: D.SavedView },
  SavedViewChanged: {
    field: Schema.Literals(["title", "body"]),
    value: Schema.String,
  },
  SaveSavedView: {},
  SavedViewSaved: {
    savedView: Schema.NullOr(D.SavedView),
    error: Schema.String,
  },
  LoadSavedViews: { more: Schema.Boolean },
  SavedViewSearchChanged: { value: Schema.String },
  BrowseSavedViews: {},
  ShowSavedViewShortcuts: {},
  LoadSavedViewShortcuts: {},
  LoadedSavedViewShortcuts: {
    version: Schema.Number,
    data: Schema.NullOr(Shortcuts),
    recentIds: RecentIds,
    error: Schema.String,
  },
  CompletedCancelLoadSavedViews: {
    version: Schema.Number,
    more: Schema.Boolean,
    debounce: Schema.Boolean,
  },
  LoadedSavedViews: {
    data: Schema.NullOr(D.SavedViewsPage),
    error: Schema.String,
    more: Schema.Boolean,
    pages: Schema.Number,
    version: Schema.Number,
  },
  PinSavedView: { savedView: D.SavedView },
  DeleteSavedView: { savedView: D.SavedView },
  ConfirmDelete: {},
  MutatedSavedView: { removed: Schema.Boolean, error: Schema.String },
  RestoreView: { savedView: D.SavedView },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
