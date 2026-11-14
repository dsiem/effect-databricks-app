import { format, parseISO } from "date-fns";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
import type { Filters } from "../../src/domain";
import type { Message } from "./message";
export type H = HtmlBuilder<Message>;
export type A = Attribute<Message>;
export type Child = Html | string;
export const number = (value: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(value));
export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
export const dateLabel = (filters: Filters) => {
  const from = filters.from
    ? format(parseISO(filters.from), "MMM d, yyyy")
    : "";
  const to = filters.to ? format(parseISO(filters.to), "MMM d, yyyy") : "";
  return from
    ? to
      ? `${from} – ${to}`
      : `From ${from}`
    : to
      ? `Through ${to}`
      : "All dates";
};
export const filterSummary = (h: H, filters: Filters) =>
  h.div(
    [h.Class("flex flex-wrap gap-1.5")],
    [
      badge(h, dateLabel(filters)),
      badge(h, filters.zip ? `Pickup ZIP ${filters.zip}` : "All pickup areas"),
    ],
  );
export const badge = (h: H, text: string) => h.span([h.Class("badge")], [text]);
export const button = (
  h: H,
  label: string,
  message: Message,
  attrs: A[] = [],
  variant = "outline",
) =>
  h.button(
    [h.Type("button"), h.Class(`btn ${variant}`), h.OnClick(message), ...attrs],
    [label],
  );
export const card = (h: H, children: Child[], classes = "") =>
  h.div(
    [h.Class(`card ${classes}`), h.DataAttribute("slot", "card")],
    children,
  );
export const title = (
  h: H,
  text: string,
  description: string,
  actions: Child[] = [],
) =>
  h.div(
    [h.Class("page-title")],
    [
      h.div(
        [],
        [h.h1([], [text]), h.p([h.Class("muted mt-2")], [description])],
      ),
      h.div([h.Class("flex flex-wrap gap-2")], actions),
    ],
  );
export const loading = (h: H, text = "Querying SQL warehouse…") =>
  card(
    h,
    [
      h.span([h.Class("loading-dot"), h.AriaHidden(true)], []),
      h.p([h.Role("status")], [text]),
      h.p(
        [h.Class("muted text-xs")],
        ["A suspended warehouse may take a moment to start."],
      ),
    ],
    "loading",
  );
export const error = (h: H, text: string, retry?: Message) =>
  card(
    h,
    [
      h.h2([], ["Request failed"]),
      h.p([h.Role("alert"), h.Class("muted mt-2")], [text]),
      ...(retry
        ? [button(h, "Try again", retry, [h.Class("btn outline mt-5")])]
        : []),
    ],
    "p-8",
  );
export const alert = (h: H, text: string) =>
  h.p([h.Role("alert"), h.Class("text-sm text-destructive")], [text]);
export const table = (h: H, headers: string[], rows: Child[][]) =>
  h.div(
    [h.Class("table-scroll")],
    [
      h.table(
        [],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                headers.map((text) => h.th([h.Scope("col")], [text])),
              ),
            ],
          ),
          h.tbody(
            [],
            rows.map((cells, index) =>
              h.tr(
                [h.Key(String(index))],
                cells.map((child) => h.td([], [child])),
              ),
            ),
          ),
        ],
      ),
    ],
  );
