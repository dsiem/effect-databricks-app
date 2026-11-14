import { Calendar, Dialog, Input } from "@foldkit/ui";
import { Option } from "effect";
import * as CalendarDate from "foldkit/calendar";
import { icon } from "./icons";
import { Message as M } from "./message";
import type { Model } from "./model";
import { button, type H } from "./ui";
import { dialog } from "./ui-dialog";
import { isoDate, parseDate } from "./ui-state";

export function calendar(h: H, model: Model) {
  const current = parseDate(`${model.calendarMonth}-01`);
  const min = model.metadata.data?.from;
  const max = model.metadata.data?.to;
  const month = (index: 0 | 1) =>
    h.submodel({
      slotId: `pickup-calendar-${index}`,
      view: Calendar.view,
      model: model.calendars[index],
      toParentMessage: (message) => M.Calendar({ index, message }),
      viewInputs: {
        maybeSelectedDate: model.filterDraft.from
          ? Option.some(parseDate(model.filterDraft.from))
          : Option.none(),
        toDaysGridLabel: (heading) => heading,
        toView: (render) => {
          // The range picker keeps month navigation in its shared toolbar.
          if (render._tag !== "Days") return h.div([], []);
          return h.div(
            [...render.root],
            [
              h.p(
                [h.Id(render.heading.id), h.Class("calendar-heading")],
                [render.heading.text],
              ),
              h.table(
                [...render.grid, h.Class("calendar-grid")],
                [
                  h.thead(
                    [],
                    [
                      h.tr(
                        [...render.headerRow],
                        render.columnHeaders.map((day) =>
                          h.th([...day.attributes], [day.name]),
                        ),
                      ),
                    ],
                  ),
                  h.tbody(
                    [],
                    render.weeks.map((week) =>
                      h.tr(
                        [...week.attributes],
                        week.cells.map((day) => {
                          const value = isoDate(day.date);
                          const selected =
                            !!model.filterDraft.from &&
                            value >= model.filterDraft.from &&
                            value <= model.filterDraft.to;
                          return h.td(
                            [...day.cellAttributes, h.AriaSelected(selected)],
                            [
                              ...(day.isInViewMonth
                                ? [
                                    h.button(
                                      [
                                        ...day.buttonAttributes,
                                        h.DataAttribute("day", value),
                                        h.Class(
                                          `calendar-day ${selected ? "selected" : ""}`,
                                        ),
                                      ],
                                      [day.label],
                                    ),
                                  ]
                                : []),
                            ],
                          );
                        }),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          );
        },
      },
    });
  return dialog(h, model, "calendar", "workspace-dialog date-dialog", [
    h.div(
      [h.Class("dialog-header")],
      [
        h.h2([h.Id(Dialog.titleId(model.dialogs.calendar))], ["Pickup dates"]),
        h.p([h.Class("muted text-xs")], ["Select a start and end date."]),
      ],
    ),
    h.div(
      [h.Class("flex items-center justify-between px-4 pt-3")],
      [
        button(
          h,
          icon(h, "chevron-left"),
          M.CalendarMonth({
            month: isoDate(CalendarDate.addMonths(current, -1)).slice(0, 7),
          }),
          [
            h.AriaLabel("Previous month"),
            h.Disabled(!!min && model.calendarMonth <= min.slice(0, 7)),
          ],
        ),
        Input.view(
          {
            id: "calendar-month",
            type: "month",
            value: model.calendarMonth,
            onInput: (value) =>
              M.CalendarMonth({ month: value || model.calendarMonth }),
            toView: ({ input }) =>
              h.input([
                ...input,
                h.AriaLabel("Calendar month"),
                ...(min ? [h.Min(min.slice(0, 7))] : []),
                ...(max ? [h.Max(max.slice(0, 7))] : []),
              ]),
          },
          h,
        ),
        button(
          h,
          icon(h, "chevron-right"),
          M.CalendarMonth({
            month: isoDate(CalendarDate.addMonths(current, 1)).slice(0, 7),
          }),
          [
            h.AriaLabel("Next month"),
            h.Disabled(!!max && model.calendarMonth >= max.slice(0, 7)),
          ],
        ),
      ],
    ),
    h.div(
      [h.Class("calendar-months")],
      [month(0), ...(!model.mobile ? [month(1)] : [])],
    ),
    h.div(
      [h.Class("dialog-footer justify-between")],
      [
        button(
          h,
          "Clear dates",
          M.ClearDates(),
          [h.Disabled(!model.filterDraft.from && !model.filterDraft.to)],
          "ghost",
        ),
        button(h, "Done", M.CloseOverlay(), [], "primary"),
      ],
    ),
  ]);
}
