import { Calendar } from "@foldkit/ui";
import { Option } from "effect";
import { Update } from "foldkit";
import * as CalendarDate from "foldkit/calendar";
import type * as D from "../../../../shared/domain";
import type { FeatureUpdate } from "../../lib/feature-update";
import { initCalendars, isoDate, parseDate } from "./calendar-state";
import { Message as M, type Message } from "./messages";
import type { Model } from "./model";
import { filtersFromQuery, queryFor } from "./query";
export function updateFilters(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
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
            ? updateFilters(
                model,
                M.CalendarDay({ day: isoDate(out.date) }),
                context,
              )
            : updateFilters(
                model,
                M.CalendarMonth({
                  month: `${out.year}-${String(out.month).padStart(2, "0")}`,
                  index: message.index,
                }),
                context,
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
      return {
        model,
        outMessage: { _tag: "Navigate", query: queryFor(model.filterDraft) },
      };
    case "ResetFilters":
      return { model, outMessage: { _tag: "Navigate", query: "" } };
    case "PickZip":
      return {
        model,
        outMessage: {
          _tag: "Navigate",
          query: queryFor({
            ...(filtersFromQuery(context.query) ?? {}),
            zip: message.zip,
          }),
        },
      };
    case "OpenCalendar":
      return {
        model: {
          ...model,
          calendar: true,
          calendarEnd: false,
          calendarMonth: (
            model.filterDraft.from ||
            model.filterDraft.to ||
            context.metadata?.from ||
            "2016-01-01"
          ).slice(0, 7),
          calendars: initCalendars(
            model.filterDraft.from ||
              model.filterDraft.to ||
              context.metadata?.from ||
              "2016-01-01",
            context.metadata?.from,
            context.metadata?.to,
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

export type Context = {
  readonly query: string;
  readonly metadata: typeof D.Metadata.Type | null;
};
export type Out = { readonly _tag: "Navigate"; readonly query: string };
