import { Calendar as UiCalendar } from "@foldkit/ui";
import { Schema } from "effect";
import type * as D from "../../../../shared/domain";
import { initCalendars } from "./calendar-state";
export const FilterDraft = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  zip: Schema.String,
});
export const Model = Schema.Struct({
  filterDraft: FilterDraft,
  calendars: Schema.Tuple([UiCalendar.Model, UiCalendar.Model]),
  calendar: Schema.Boolean,
  calendarMonth: Schema.String,
  calendarEnd: Schema.Boolean,
});

export type Model = typeof Model.Type;

export const init = (filters: D.Filters = {}): Model => ({
  filterDraft: {
    from: filters.from ?? "",
    to: filters.to ?? "",
    zip: filters.zip ?? "",
  },
  calendars: initCalendars("2016-01-01"),
  calendar: false,
  calendarMonth: "",
  calendarEnd: false,
});
