import { Calendar } from "@foldkit/ui";
import { Option } from "effect";
import { Update } from "foldkit";
import * as CalendarDate from "foldkit/calendar";
import { Message as M, type Message } from "../../app/message";
import { filtersFromQuery, type Model, queryFor } from "../../app/model";
import { navigate } from "../../app/navigation";
import { initCalendars, isoDate, parseDate } from "../../app/ui-state";
import type { ApiClient } from "../../lib/api-client";
export function updateFilters(
  model: Model,
  message: Extract<
    Message,
    {
      readonly _tag:
        | "Calendar"
        | "FilterChanged"
        | "ApplyFilters"
        | "ResetFilters"
        | "PickZip"
        | "OpenCalendar"
        | "CalendarMonth"
        | "CalendarDay"
        | "ClearDates";
    }
  >,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "Calendar":
      return Update.foldChild({
        update: Calendar.update,
        read: (model: Model) => Option.some(model.calendars[message.index]),
        write: (model, child) => ({
          ...model,
          calendars:
            message.index === 0
              ? ([child, model.calendars[1]] as const)
              : ([model.calendars[0], child] as const),
        }),
        toParentMessage: (child) =>
          M.Calendar({ index: message.index, message: child }),
        foldOutMessage: (out) => (model) =>
          out._tag === "SelectedDate"
            ? updateFilters(model, M.CalendarDay({ day: isoDate(out.date) }))
            : updateFilters(
                model,
                M.CalendarMonth({
                  month: `${out.year}-${String(out.month).padStart(2, "0")}`,
                  index: message.index,
                }),
              ),
      })(model, message.message);
    case "FilterChanged":
      return {
        model: {
          ...model,
          filterDraft: { ...model.filterDraft, [message.field]: message.value },
        },
      };
    case "ApplyFilters":
      return navigate(model, model.path, queryFor(model.filterDraft));
    case "ResetFilters":
      return navigate(model, model.path, "");
    case "PickZip":
      return navigate(
        model,
        model.path,
        queryFor({
          ...(filtersFromQuery(model.query) ?? {}),
          zip: message.zip,
        }),
      );
    case "OpenCalendar":
      return {
        model: {
          ...model,
          calendar: true,
          calendarEnd: false,
          calendarMonth: (
            model.filterDraft.from ||
            model.filterDraft.to ||
            model.metadata.data?.from ||
            "2016-01-01"
          ).slice(0, 7),
          calendars: initCalendars(
            model.filterDraft.from ||
              model.filterDraft.to ||
              model.metadata.data?.from ||
              "2016-01-01",
            model.metadata.data?.from,
            model.metadata.data?.to,
            model.calendars[0].today,
          ),
        },
      };
    case "CalendarMonth": {
      const value = CalendarDate.subtractMonths(
        parseDate(`${message.month}-01`),
        message.index ?? 0,
      );
      return {
        model: {
          ...model,
          calendarMonth: isoDate(value).slice(0, 7),
          calendars: [
            message.index === 0
              ? model.calendars[0]
              : Calendar.focusDate(model.calendars[0], value),
            message.index === 1
              ? model.calendars[1]
              : Calendar.focusDate(
                  model.calendars[1],
                  CalendarDate.addMonths(value, 1),
                ),
          ],
        },
      };
    }
    case "CalendarDay": {
      const dates = [
        model.calendarEnd ? model.filterDraft.from || message.day : message.day,
        message.day,
      ].sort();
      return {
        model: {
          ...model,
          calendarEnd: !model.calendarEnd,
          filterDraft: {
            ...model.filterDraft,
            from: dates[0] ?? message.day,
            to: dates[1] ?? message.day,
          },
        },
      };
    }
    case "ClearDates":
      return {
        model: {
          ...model,
          calendarEnd: false,
          filterDraft: { ...model.filterDraft, from: "", to: "" },
        },
      };
  }
}
