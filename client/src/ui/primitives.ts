import { Button } from "@foldkit/ui";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
export type H<Message> = HtmlBuilder<Message>;
export type Child = Html | string;
export const badge = <Message>(h: H<Message>, text: string) =>
  h.span([h.Class("badge")], [text]);
export interface ButtonOptions<Message> {
  readonly label: Child;
  readonly onClick: Message;
  readonly variant?: "outline" | "primary" | "ghost" | "destructive";
  readonly className?: string;
  readonly attributes?: ReadonlyArray<
    Exclude<Attribute<Message>, { readonly _tag: "Class" }>
  >;
}

export const button = <Message>(
  h: H<Message>,
  options: ButtonOptions<Message>,
) =>
  Button.view(
    {
      onClick: options.onClick,
      toView: ({ button }) =>
        h.button(
          [
            ...button,
            ...(options.attributes ?? []),
            h.Class(
              `btn ${options.variant ?? "outline"} ${options.className ?? ""}`,
            ),
          ],
          [options.label],
        ),
    },
    h,
  );

export const card = <Message>(h: H<Message>, children: Child[], classes = "") =>
  h.div(
    [h.Class(`card ${classes}`), h.DataAttribute("slot", "card")],
    children,
  );
export const title = <Message>(
  h: H<Message>,
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
export const loading = <Message>(h: H<Message>, text = "Loading…") =>
  card(
    h,
    [
      h.span([h.Class("loading-dot"), h.AriaHidden(true)], []),
      h.p([h.Role("status")], [text]),
    ],
    "loading",
  );
export const error = <Message>(h: H<Message>, text: string, retry?: Message) =>
  card(
    h,
    [
      h.h2([], ["Request failed"]),
      h.p([h.Role("alert"), h.Class("muted mt-2")], [text]),
      ...(retry
        ? [
            button(h, {
              label: "Try again",
              onClick: retry,
              className: " mt-5",
            }),
          ]
        : []),
    ],
    "p-8",
  );
export const alert = <Message>(h: H<Message>, text: string) =>
  h.p([h.Role("alert"), h.Class("text-sm text-destructive")], [text]);
export const table = <Message>(
  h: H<Message>,
  headers: string[],
  rows: Child[][],
) =>
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
