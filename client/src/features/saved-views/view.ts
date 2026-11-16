import { Dialog, Input, Popover, Textarea } from "@foldkit/ui";
import { Option } from "effect";
import { defineView } from "foldkit/submodel";
import type { SavedView } from "../../../../shared/domain";
import { filterSummary } from "../../domain/filter-summary";
import { filtersFromQuery, queryFor } from "../../domain/filters";
import { dateLabel } from "../../lib/format";
import { dialog } from "../../ui/dialog";
import { field } from "../../ui/field";
import { icon } from "../../ui/icons";
import { alert, button, type Child, error, loading } from "../../ui/primitives";
import { viewOption, viewPicker } from "../../ui/view-picker";
import type { Model } from "./model";
import {
  resultId,
  searchId,
  searchText,
  shortcutGroups,
  visibleSavedViews,
} from "./picker";
import { appliedView } from "./selection";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";

const close = (h: H, label = "Close") =>
  button(h, {
    label: icon(h, "x"),
    onClick: M.CloseSavedView(),
    attributes: [h.AriaLabel(label)],
    className: " dialog-close",
    variant: "ghost",
  });
type PickerModel = Model & {
  readonly query: string;
  readonly canSave: boolean;
};

function viewRow(
  h: H,
  model: PickerModel,
  options: {
    readonly savedView: SavedView;
    readonly selected: boolean;
    readonly previous: SavedView | undefined;
    readonly next: SavedView | undefined;
  },
) {
  const { savedView } = options;
  return h.div(
    [h.Key(savedView.id)],
    [
      viewOption(h, {
        title: savedView.title,
        accessibleLabel: `Open saved view for ${savedView.title}`,
        summary: filterSummary(h, savedView.filters),
        description: savedView.body,
        selected: options.selected,
        pinned: savedView.pinned,
        onSelect: M.RestoreView({ savedView }),
        attributes: [
          h.Id(resultId(savedView.id)),
          h.AriaDescription(
            `${dateLabel(savedView.filters)}. Pickup ZIP ${savedView.filters.zip ?? "all areas"}. ${savedView.body}`,
          ),
          h.OnKeyDownFocus((key) => {
            const target =
              key === "ArrowDown"
                ? options.next
                : key === "ArrowUp"
                  ? options.previous
                  : undefined;
            if (key === "ArrowUp" && !options.previous)
              return Option.some({
                focusSelector: `#${searchId}`,
                message: M.Idle(),
              });
            return target
              ? Option.some({
                  focusSelector: `#${resultId(target.id)}`,
                  message: M.Idle(),
                })
              : Option.none();
          }),
        ],
        actions: [
          button(h, {
            label: icon(h, savedView.pinned ? "pin" : "pin-off"),
            onClick: M.PinSavedView({ savedView }),
            busy: model.savedViewBusy,
            size: "icon",
            variant: "ghost",
            attributes: [
              h.AriaLabel(
                `${savedView.pinned ? "Unpin" : "Pin"} ${savedView.title}`,
              ),
            ],
          }),
          button(h, {
            label: icon(h, "pencil"),
            onClick: M.EditSavedView({ savedView }),
            size: "icon",
            variant: "ghost",
            attributes: [h.AriaLabel(`Edit ${savedView.title}`)],
          }),
          button(h, {
            label: icon(h, "trash-2"),
            onClick: M.DeleteSavedView({ savedView }),
            size: "icon",
            variant: "ghost",
            attributes: [h.AriaLabel(`Delete ${savedView.title}`)],
          }),
        ],
      }),
    ],
  );
}

function quickViews(h: H, model: PickerModel, renderedRows: Child[]): Child[] {
  if (model.shortcuts.loading)
    return [loading(h, "Loading pinned and recent views…")];
  if (model.shortcuts.error)
    return [error(h, model.shortcuts.error, M.LoadSavedViewShortcuts())];
  const groups = shortcutGroups(model);
  let offset = 0;
  return groups.length
    ? groups.map((group) => {
        const start = offset;
        offset += group.rows.length;
        return h.div(
          [h.Key(group.title)],
          [
            h.h3([h.Class("view-picker-count")], [group.title]),
            ...renderedRows.slice(start, offset),
          ],
        );
      })
    : [
        h.div(
          [h.Class("view-picker-empty")],
          [
            h.h3([], ["No saved views"]),
            h.p(
              [h.Class("muted text-sm mt-2")],
              ["Save a set of filters to return to it later."],
            ),
          ],
        ),
      ];
}

function matchingViews(
  h: H,
  model: PickerModel,
  renderedRows: Child[],
): Child[] {
  const { data, loading: busy, error: problem } = model.savedViews;
  if (busy && !data) return [loading(h, "Searching saved views…")];
  if (problem && !data)
    return [error(h, problem, M.LoadSavedViews({ more: false }))];
  const rows = data?.rows ?? [];
  return [
    h.p(
      [h.Class("view-picker-count"), h.AriaLive("polite"), h.Role("status")],
      [
        `${rows.length} ${model.pickerMode._tag === "Search" ? "matching " : "saved "}${rows.length === 1 ? "view" : "views"} shown${data?.nextCursor ? " · more available" : ""}`,
      ],
    ),
    ...renderedRows,
    ...(!busy && !problem && !rows.length
      ? [
          h.div(
            [h.Class("view-picker-empty")],
            [
              h.h3([], ["No matching views"]),
              h.p(
                [h.Class("muted text-sm mt-2")],
                ["Try a shorter name, a finding, a date, or a pickup ZIP."],
              ),
              button(h, {
                label: "Clear search",
                onClick: M.ShowSavedViewShortcuts(),
                size: "small",
                className: "mt-3",
              }),
            ],
          ),
        ]
      : []),
    ...(problem ? [alert(h, problem)] : []),
    ...(data?.nextCursor || problem
      ? [
          button(h, {
            label: busy
              ? "Loading views…"
              : problem
                ? "Retry loading views"
                : "Load more views",
            onClick: M.LoadSavedViews({ more: !!data?.nextCursor }),
            busy,
            attributes: [h.Key("load-saved-views")],
            className: "w-full mt-2",
          }),
        ]
      : []),
  ];
}

function savedViews(h: H, model: PickerModel) {
  const filters = filtersFromQuery(model.query) ?? {};
  const selected = appliedView(model, filters);
  const rows = visibleSavedViews(model);
  const renderedRows = rows.map((savedView, index) =>
    viewRow(h, model, {
      savedView,
      selected: selected?.id === savedView.id,
      previous: rows[index - 1],
      next: rows[index + 1],
    }),
  );
  return viewPicker(h, {
    model: model.picker,
    onMessage: (message) => M.SavedViewsPicker({ message }),
    label: "Saved views",
    focusSelector: `#${searchId}`,
    triggerLabel:
      selected?.title ?? (queryFor(filters) ? "Custom view" : "All trips"),
    children: [
      h.div(
        [h.Class("view-picker-header")],
        [
          h.div(
            [],
            [
              h.h2([], ["Saved views"]),
              h.p(
                [h.Class("muted text-xs mt-1")],
                ["Find a view and apply its filters here."],
              ),
            ],
          ),
          button(h, {
            label: icon(h, "x"),
            onClick: M.SavedViewsPicker({
              message: Popover.Message.RequestedClose(),
            }),
            size: "icon",
            variant: "ghost",
            attributes: [h.AriaLabel("Close saved views")],
          }),
        ],
      ),
      h.div(
        [h.Class("view-picker-search")],
        [
          Input.view(
            {
              id: searchId,
              type: "search",
              value: searchText(model),
              placeholder: "Search name, finding, date, or ZIP…",
              onInput: (value) => M.SavedViewSearchChanged({ value }),
              toView: ({ input }) =>
                h.div(
                  [h.Class("view-picker-search-input")],
                  [
                    icon(h, "search"),
                    h.input([
                      ...input,
                      h.Class("input"),
                      h.AriaLabel("Search all saved views"),
                      h.AriaBusy(
                        model.pickerMode._tag === "Quick"
                          ? model.shortcuts.loading
                          : model.savedViews.loading,
                      ),
                      h.Maxlength(200),
                      h.Autocomplete("off"),
                      h.AriaDescribedBy("saved-view-search-help"),
                      h.OnKeyDownFocus((key) =>
                        key === "ArrowDown" && rows[0]
                          ? Option.some({
                              focusSelector: `#${resultId(rows[0].id)}`,
                              message: M.Idle(),
                            })
                          : Option.none(),
                      ),
                      h.OnKeyDownPreventDefault((key) =>
                        key === "Enter" && rows[0]
                          ? Option.some(M.RestoreView({ savedView: rows[0] }))
                          : Option.none(),
                      ),
                    ]),
                  ],
                ),
            },
            h,
          ),
          h.p(
            [h.Id("saved-view-search-help"), h.Class("muted text-xs mt-2")],
            ["Search all saved views. ↓ to choose, Enter to apply."],
          ),
        ],
      ),
      h.div(
        [h.Class("view-picker-list")],
        [
          ...(model.pickerMode._tag !== "Search"
            ? [
                viewOption(h, {
                  title: "All trips",
                  accessibleLabel: "Show all trips",
                  summary: h.span(
                    [h.Class("muted text-xs")],
                    ["No filters applied"],
                  ),
                  selected: !queryFor(filters) && !selected,
                  onSelect: M.ClearView(),
                }),
              ]
            : []),
          ...(model.pickerMode._tag === "Quick"
            ? quickViews(h, model, renderedRows)
            : matchingViews(h, model, renderedRows)),
          ...(model.savedViewError && !model.deleting
            ? [alert(h, model.savedViewError)]
            : []),
        ],
      ),
      h.div(
        [h.Class("view-picker-browse")],
        [
          button(h, {
            label:
              model.pickerMode._tag === "Quick"
                ? "Browse all views"
                : "Pinned and recent views",
            onClick:
              model.pickerMode._tag === "Quick"
                ? M.BrowseSavedViews()
                : M.ShowSavedViewShortcuts(),
            size: "small",
            variant: "ghost",
          }),
          h.span([h.Class("muted text-xs")], ["Esc to close"]),
        ],
      ),
      h.div(
        [h.Class("view-picker-footer")],
        [
          h.p(
            [h.Class("muted text-xs")],
            [
              model.canSave
                ? "Saved views are shared with your team."
                : "Apply your changes before saving a view.",
            ],
          ),
          button(h, {
            label: "Save this view",
            onClick: M.NewSavedView(),
            disabled: !model.canSave,
            size: "small",
          }),
        ],
      ),
    ],
  });
}
function editor(h: H, model: Model) {
  const editor = model.editor;
  if (!editor) return null;
  const { draft, saving } = editor;
  const name = draft.version !== null ? "Edit saved view" : "Save this view";
  return dialog(h, {
    model: model.dialogs.savedView,
    onMessage: (message) => M.SavedViewDialog({ message }),
    className: "dialog-panel overflow-y-auto",
    children: [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id(Dialog.titleId(model.dialogs.savedView))], [name]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            ["Give this view a name so you and your team can return to it."],
          ),
        ],
      ),
      h.form(
        [h.OnSubmit(M.SaveSavedView()), h.Class("p-6 space-y-5")],
        [
          field(h, {
            id: "saved-view-title",
            label: "View name",
            value: draft.title,
            onInput: (value) => M.SavedViewChanged({ field: "title", value }),
            placeholder: "e.g. Midtown fare review",
            attributes: [h.Required(true), h.Maxlength(160)],
          }),
          h.div(
            [],
            [
              h.label(
                [h.For("saved-view-body"), h.Class("field-label")],
                ["Finding (optional)"],
              ),
              Textarea.view(
                {
                  id: "saved-view-body",
                  value: draft.body,
                  onInput: (value) =>
                    M.SavedViewChanged({ field: "body", value }),
                  placeholder:
                    "What is worth returning to? Add context or a next step…",
                  toView: (attributes) =>
                    h.textarea([
                      ...attributes.textarea,
                      h.Class("input mt-2 min-h-28"),
                      h.Maxlength(10000),
                    ]),
                },
                h,
              ),
            ],
          ),
          h.div(
            [h.Class("inset-panel")],
            [
              h.p([h.Class("text-sm font-medium mb-2")], ["Applied filters"]),
              filterSummary(h, draft.filters),
              h.p(
                [h.Class("muted text-xs leading-5 mt-3")],
                [
                  draft.version !== null
                    ? "This saved view keeps its original filters, even when your Explore view changes."
                    : "These filters are saved with your view so you can reopen it later.",
                ],
              ),
            ],
          ),
          ...(editor.error ? [alert(h, editor.error)] : []),
          h.div(
            [h.Class("flex justify-end gap-2")],
            [
              button(h, {
                label: "Cancel",
                onClick: M.CloseSavedView(),
                disabled: saving,
              }),
              button(h, {
                type: "submit",
                label: saving ? "Saving…" : "Save view",
                disabled: saving || !draft.title.trim(),
                variant: "primary",
              }),
            ],
          ),
        ],
      ),
    ],
  });
}
function deleteDialog(h: H, model: Model) {
  return dialog(h, {
    model: model.dialogs.delete,
    onMessage: (message) => M.DeleteDialog({ message }),
    className: "dialog-panel overflow-y-auto",
    children: [
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2(
            [h.Id(Dialog.titleId(model.dialogs.delete))],
            ["Delete this saved view?"],
          ),
          h.p(
            [h.Class("muted text-sm mt-2")],
            [
              `“${model.deleting?.title ?? ""}” will be removed from saved views.`,
            ],
          ),
        ],
      ),
      ...(model.savedViewError ? [alert(h, model.savedViewError)] : []),
      h.div(
        [h.Class("dialog-footer")],
        [
          button(h, {
            label: "Cancel",
            onClick: M.CloseDelete(),
            disabled: model.savedViewBusy,
          }),
          button(h, {
            label: model.savedViewBusy ? "Deleting…" : "Delete view",
            onClick: M.ConfirmDelete(),
            disabled: model.savedViewBusy,
            variant: "destructive",
          }),
        ],
      ),
    ],
  });
}

export const savedViewsView = defineView<PickerModel, typeof M.Type>(
  (model, h) => savedViews(h, model),
);

export const editorView = defineView<Model, typeof M.Type>((model, h) =>
  editor(h, model),
);

export const deleteDialogView = defineView<Model, typeof M.Type>((model, h) =>
  deleteDialog(h, model),
);
