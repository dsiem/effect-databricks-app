import { Dialog, Tabs } from "@foldkit/ui";
import { Schema } from "effect";
export const DialogId = Schema.Literals([
  "views",
  "note",
  "delete",
  "trip",
  "calendar",
  "navigation",
  "genie",
]);
export const uiMessages = {
  Idle: {},
  CloseOverlay: {},
  LoadPage: {},
  Dialog: {
    id: DialogId,
    message: Dialog.Message,
  },
  MetricTabs: { message: Tabs.Message },
};

export type DialogId = typeof DialogId.Type;
