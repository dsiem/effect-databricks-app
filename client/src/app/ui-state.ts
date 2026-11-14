import { Dialog, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";

export { DialogId } from "../lib/ui-messages";
export const Dialogs = Schema.Struct({
  note: Dialog.Model,
  delete: Dialog.Model,
  trip: Dialog.Model,
  navigation: Dialog.Model,
  genie: Dialog.Model,
});
export const initDialogs = () => ({
  note: Dialog.init({ id: "note", focusSelector: "#note-title" }),
  delete: Dialog.init({ id: "delete-note", focusSelector: "button" }),
  trip: Dialog.init({
    id: "trip-details",
    focusSelector: "#trip-details-dialog-title",
  }),
  navigation: Dialog.init({ id: "mobile-navigation", focusSelector: "a" }),
  genie: Dialog.init({ id: "genie-helper", focusSelector: "#genie-composer" }),
});
export const initTooltip = (id: string) =>
  Tooltip.init({ id: `sidebar-${id}` });
