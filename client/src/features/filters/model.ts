import { Calendar as UiCalendar } from "@foldkit/ui";
import { Schema } from "effect";
export const FilterDraft = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  zip: Schema.String,
});
export const fields = {
  filterDraft: FilterDraft,
  calendars: Schema.Tuple([UiCalendar.Model, UiCalendar.Model]),
  calendar: Schema.Boolean,
  calendarMonth: Schema.String,
  calendarEnd: Schema.Boolean,
};
