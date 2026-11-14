import { Calendar, Dialog, Tabs, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import * as CalendarDate from "foldkit/calendar";

export const DialogId = Schema.Literals([
  "views",
  "note",
  "delete",
  "trip",
  "calendar",
  "navigation",
  "genie",
]);
export type DialogId = typeof DialogId.Type;
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
export const initMetricTabs = () => Tabs.init({ id: "daily-metric" });
export const initTooltip = (id: string) =>
  Tooltip.init({ id: `sidebar-${id}` });
export const parseDate = Schema.decodeUnknownSync(
  CalendarDate.CalendarDateFromIsoString,
);
export const isoDate = Schema.encodeSync(
  CalendarDate.CalendarDateFromIsoString,
);
export const initCalendars = (
  value: string,
  min?: string,
  max?: string,
  today = parseDate(value),
) => {
  const date = parseDate(value);
  const config = {
    today,
    locale: {
      ...CalendarDate.defaultEnglishLocale,
      firstDayOfWeek: "Monday" as const,
    },
    ...(min ? { minDate: parseDate(min) } : {}),
    ...(max ? { maxDate: parseDate(max) } : {}),
  };
  return [
    Calendar.init({ ...config, id: "pickup-start", initialViewDate: date }),
    Calendar.init({
      ...config,
      id: "pickup-end",
      initialViewDate: CalendarDate.addMonths(date, 1),
    }),
  ] as const;
};
