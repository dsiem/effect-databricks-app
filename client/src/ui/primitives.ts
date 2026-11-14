import { Button } from "@foldkit/ui";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
export type H<Message> = HtmlBuilder<Message>;
export type Child = Html | string;
export const badge = <Message>(h: H<Message>, text: string) =>
  h.span([h.Class("badge")], [text]);
export interface ButtonOptions<Message> {
  readonly label: Child;
  readonly onClick?: Message;
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly variant?: "outline" | "primary" | "ghost" | "destructive";
  readonly size?: "default" | "small" | "icon";
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
      type: options.type ?? "button",
      ...(options.onClick === undefined ? {} : { onClick: options.onClick }),
      isDisabled: options.disabled ?? false,
      toView: ({ button }) =>
        h.button(
          [
            ...button,
            h.Disabled(options.disabled ?? false),
            ...(options.attributes ?? []),
            h.Class(
              `btn btn-${options.variant ?? "outline"} btn-${options.size ?? "default"} ${options.className ?? ""}`,
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

/** Presentation only: callers own the metric's meaning and formatting. */
export const metric = <Message>(
  h: H<Message>,
  options: {
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly icon?: Child;
  },
) =>
  card(
    h,
    [
      h.div(
        [h.Class("metric-heading")],
        [
          h.h2([h.Class("metric-label")], [options.label]),
          ...(options.icon ? [options.icon] : []),
        ],
      ),
      h.p([h.Class("metric-value")], [options.value]),
      h.p([h.Class("metric-detail")], [options.detail]),
    ],
    "metric",
  );

export const panelHeader = <Message>(
  h: H<Message>,
  options: {
    readonly title: string;
    readonly description?: string;
    readonly actions?: Child[];
  },
) =>
  h.div(
    [h.Class("chart-header")],
    [
      h.div(
        [],
        [
          h.h2([], [options.title]),
          ...(options.description
            ? [h.p([h.Class("muted text-xs mt-1")], [options.description])]
            : []),
        ],
      ),
      ...(options.actions?.length
        ? [h.div([h.Class("panel-actions")], options.actions)]
        : []),
    ],
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
  card(h, [h.p([h.Role("status")], [text])], "loading");
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
  h.p([h.Role("alert"), h.Class("text-sm text-red-700")], [text]);
export const table = <Message>(
  h: H<Message>,
  options: {
    readonly caption: string;
    readonly headers: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<{
      readonly key: string;
      readonly cells: ReadonlyArray<Child>;
    }>;
  },
) =>
  h.div(
    [h.Class("table-scroll")],
    [
      h.table(
        [],
        [
          h.caption([h.Class("sr-only")], [options.caption]),
          h.thead(
            [],
            [
              h.tr(
                [],
                options.headers.map((text) => h.th([h.Scope("col")], [text])),
              ),
            ],
          ),
          h.tbody(
            [],
            options.rows.map(({ key, cells }) =>
              h.tr(
                [h.Key(key)],
                cells.map((child) => h.td([], [child])),
              ),
            ),
          ),
        ],
      ),
    ],
  );
