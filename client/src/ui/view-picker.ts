import { Popover } from "@foldkit/ui";
import type { Attribute } from "foldkit/html";
import { icon } from "./icons";
import { button, type Child, type H } from "./primitives";

export function viewPicker<Message>(
  h: H<Message>,
  options: {
    readonly model: Popover.Model;
    readonly onMessage: (message: Popover.Message) => Message;
    readonly label: string;
    readonly triggerLabel: string;
    readonly children: Child[];
    readonly focusSelector?: string;
  },
) {
  return h.submodel({
    slotId: options.model.id,
    model: options.model,
    view: Popover.view,
    toParentMessage: options.onMessage,
    viewInputs: {
      ariaLabel: options.label,
      ...(options.focusSelector
        ? { focusSelector: options.focusSelector }
        : {}),
      anchor: { placement: "bottom-start", gap: 8, padding: 12 },
      toView: ({ button: trigger, panel, backdrop, isVisible }) =>
        h.div(
          [h.Class("view-picker")],
          [
            h.button(
              [...trigger, h.Class("btn view-picker-trigger")],
              [
                icon(h, "book-open"),
                h.span([h.Class("truncate")], [options.triggerLabel]),
                icon(h, "chevron-down"),
              ],
            ),
            ...(isVisible
              ? [
                  h.div([...backdrop, h.Class("picker-backdrop")], []),
                  h.div(
                    [
                      ...panel,
                      h.Class("view-picker-panel"),
                      h.Role("dialog"),
                      h.AriaLabel(options.label),
                      h.AriaModal(options.model.isModal),
                      h.Tabindex(-1),
                    ],
                    options.children,
                  ),
                ]
              : []),
          ],
        ),
    },
  });
}

export function viewOption<Message>(
  h: H<Message>,
  options: {
    readonly title: string;
    readonly accessibleLabel: string;
    readonly summary: Child;
    readonly description?: string;
    readonly selected: boolean;
    readonly pinned?: boolean;
    readonly onSelect: Message;
    readonly actions?: Child[];
    readonly attributes?: ReadonlyArray<
      Exclude<Attribute<Message>, { readonly _tag: "Class" }>
    >;
  },
) {
  return h.div(
    [h.Class(`view-option ${options.selected ? "is-selected" : ""}`)],
    [
      button(h, {
        label: h.span(
          [h.Class("view-option-content")],
          [
            h.span(
              [h.Class("view-option-title")],
              [
                h.span([], [options.title]),
                ...(options.pinned ? [icon(h, "pin")] : []),
                ...(options.selected
                  ? [h.span([h.Class("view-option-applied")], ["Applied"])]
                  : []),
              ],
            ),
            options.summary,
            ...(options.description
              ? [
                  h.span(
                    [h.Class("view-option-description")],
                    [options.description],
                  ),
                ]
              : []),
          ],
        ),
        onClick: options.onSelect,
        variant: "ghost",
        className: "view-option-open",
        attributes: [
          h.AriaLabel(options.accessibleLabel),
          ...(options.attributes ?? []),
        ],
      }),
      ...(options.actions?.length
        ? [h.div([h.Class("view-option-actions")], options.actions)]
        : []),
    ],
  );
}
