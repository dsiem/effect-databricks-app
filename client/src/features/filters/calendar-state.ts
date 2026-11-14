import { Calendar } from "@foldkit/ui";
import { Schema } from "effect";
import * as CalendarDate from "foldkit/calendar";
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
