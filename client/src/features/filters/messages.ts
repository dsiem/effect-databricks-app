import { Calendar as UiCalendar } from "@foldkit/ui";
import { Schema } from "effect";

export const messages = {
  Calendar: { index: Schema.Literals([0, 1]), message: UiCalendar.Message },
  FilterChanged: {
    field: Schema.Literals(["from", "to", "zip"]),
    value: Schema.String,
  },
  ApplyFilters: {},
  ResetFilters: {},
  PickZip: { zip: Schema.String },
  OpenCalendar: {},
  CalendarMonth: {
    month: Schema.String,
    index: Schema.optionalKey(Schema.Literals([0, 1])),
  },
  CalendarDay: { day: Schema.String },
  ClearDates: {},
};
