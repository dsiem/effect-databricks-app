import { Dialog, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";

export { DialogId } from "../lib/ui-messages";
export const Dialogs = Schema.Struct({
  views: Dialog.Model,
  note: Dialog.Model,
  delete: Dialog.Model,
  trip: Dialog.Model,
  calendar: Dialog.Model,
  navigation: Dialog.Model,
  genie: Dialog.Model,
});
export const initDialogs = () => ({
  views: Dialog.init({ id: "saved-views", focusSelector: ".dialog-close" }),
  note: Dialog.init({ id: "note", focusSelector: "#note-title" }),
  delete: Dialog.init({ id: "delete-note", focusSelector: "button" }),
  trip: Dialog.init({
    id: "trip-details",
    focusSelector: "#trip-details-dialog-title",
  }),
  calendar: Dialog.init({ id: "pickup-dates", focusSelector: '[role="grid"]' }),
  navigation: Dialog.init({ id: "mobile-navigation", focusSelector: "a" }),
  genie: Dialog.init({ id: "genie-helper", focusSelector: "#genie-composer" }),
});
export const initTooltip = (id: string) =>
  Tooltip.init({ id: `sidebar-${id}` });
