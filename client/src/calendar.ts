import {
  addDays,
  addMonths,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
} from "date-fns";
import { Option } from "effect";
import { DialogMount } from "./browser";
import { Message as M } from "./message";
import type { Model } from "./model";
import { button, type H } from "./ui";

export function calendar(h: H, model: Model) {
  const current = parseISO(`${model.calendarMonth}-01`);
  const min = model.metadata.data?.from;
  const max = model.metadata.data?.to;
  const month = (offset: number) => {
    const date = addMonths(current, offset);
    const days = getDaysInMonth(date);
    const leading = (date.getDay() + 6) % 7;
    const cells = Array.from(
      { length: Math.ceil((leading + days) / 7) * 7 },
      (_, i) => {
        const day = i - leading + 1;
        if (day < 1 || day > days) return h.td([], []);
        const value = format(
          addDays(startOfMonth(date), day - 1),
          "yyyy-MM-dd",
        );
        const selected =
          !!model.filterDraft.from &&
          value >= model.filterDraft.from &&
          value <= model.filterDraft.to;
        return h.td(
          [],
          [
            h.button(
              [
                h.Type("button"),
                h.Attribute("data-day", value),
                h.AriaLabel(format(parseISO(value), "EEEE, MMMM do, yyyy")),
                h.AriaPressed(String(selected)),
                h.Class(`calendar-day ${selected ? "selected" : ""}`),
                h.Disabled(!!((min && value < min) || (max && value > max))),
                h.OnClick(M.CalendarDay({ day: value })),
                h.OnKeyDownFocus((key) => {
                  const movement: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                    Home: -(i % 7),
                    End: 6 - (i % 7),
                  };
                  const delta = movement[key];
                  if (delta === undefined) return Option.none();
                  const next = format(
                    addDays(parseISO(value), delta),
                    "yyyy-MM-dd",
                  );
                  return Option.some({
                    focusSelector: `[data-day="${next}"]`,
                    message: M.Idle(),
                  });
                }),
              ],
              [String(day)],
            ),
          ],
        );
      },
    );
    return h.table(
      [
        h.Role("grid"),
        h.AriaLabel(format(date, "MMMM yyyy")),
        h.Class("calendar-grid"),
      ],
      [
        h.caption([], [format(date, "MMMM yyyy")]),
        h.thead(
          [],
          [
            h.tr(
              [],
              ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) =>
                h.th([h.Scope("col")], [day]),
              ),
            ),
          ],
        ),
        h.tbody(
          [],
          Array.from({ length: cells.length / 7 }, (_, i) =>
            h.tr([], cells.slice(i * 7, i * 7 + 7)),
          ),
        ),
      ],
    );
  };
  return h.dialog(
    [
      h.Key("calendar"),
      h.Class("workspace-dialog date-dialog"),
      h.AriaLabelledBy("calendar-title"),
      h.OnMount(
        DialogMount({
          modal: true,
          focus: "button.calendar-day:not(:disabled)",
        }),
      ),
    ],
    [
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id("calendar-title")], ["Pickup dates"]),
          h.p([h.Class("muted text-xs")], ["Select a start and end date."]),
        ],
      ),
      h.div(
        [h.Class("flex items-center justify-between px-4 pt-3")],
        [
          button(
            h,
            "‹",
            M.CalendarMonth({
              month: format(addMonths(current, -1), "yyyy-MM"),
            }),
            [
              h.AriaLabel("Previous month"),
              h.Disabled(
                !!min && format(current, "yyyy-MM") <= min.slice(0, 7),
              ),
            ],
          ),
          h.input([
            h.Type("month"),
            h.AriaLabel("Calendar month"),
            h.Value(model.calendarMonth),
            ...(min ? [h.Min(min.slice(0, 7))] : []),
            ...(max ? [h.Max(max.slice(0, 7))] : []),
            h.OnInput((value) =>
              M.CalendarMonth({ month: value || model.calendarMonth }),
            ),
          ]),
          button(
            h,
            "›",
            M.CalendarMonth({
              month: format(addMonths(current, 1), "yyyy-MM"),
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
    ],
  );
}
