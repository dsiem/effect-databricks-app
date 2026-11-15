import { Dialog, Popover, Textarea } from "@foldkit/ui";
import { defineView } from "foldkit/submodel";
import { filterSummary } from "../../domain/filter-summary";
import { filtersFromQuery, queryFor } from "../../domain/filters";
import { dialog } from "../../ui/dialog";
import { field } from "../../ui/field";
import { icon } from "../../ui/icons";
import { alert, button, type Child, error, loading } from "../../ui/primitives";
import { viewOption, viewPicker } from "../../ui/view-picker";
import type { Model } from "./model";
import { appliedView } from "./selection";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";

const close = (h: H, label = "Close") =>
  button(h, {
    label: icon(h, "x"),
    onClick: M.CloseNote(),
    attributes: [h.AriaLabel(label)],
    className: " dialog-close",
    variant: "ghost",
  });
type PickerModel = Model & {
  readonly query: string;
  readonly canSave: boolean;
};
function savedViewList(h: H, model: PickerModel): Child[] {
  const data = model.notes.data;
  if (model.notes.loading && !data) return [loading(h, "Loading saved views…")];
  if (model.notes.error && !data)
    return [error(h, model.notes.error, M.LoadNotes({ more: false }))];
  const rows = data?.rows ?? [];
  const selected = appliedView(model, filtersFromQuery(model.query) ?? {});
  return [
    ...(!rows.length
      ? [
          h.div(
            [h.Class("view-picker-empty")],
            [
              h.h2([], ["No saved views"]),
              h.p(
                [h.Class("muted text-sm mt-2")],
                ["Save a set of filters to return to it later."],
              ),
            ],
          ),
        ]
      : []),
    ...rows.map((note) =>
      h.div(
        [h.Key(note.id)],
        [
          viewOption(h, {
            title: note.title,
            accessibleLabel: `Open saved view for ${note.title}`,
            summary: filterSummary(h, note.filters),
            description: note.body,
            selected: selected?.id === note.id,
            pinned: note.pinned,
            onSelect: M.RestoreView({ note }),
            actions: [
              button(h, {
                label: icon(h, note.pinned ? "pin" : "pin-off"),
                onClick: M.PinNote({ note }),
                busy: model.noteBusy,
                size: "icon",
                variant: "ghost",
                attributes: [
                  h.AriaLabel(`${note.pinned ? "Unpin" : "Pin"} ${note.title}`),
                ],
              }),
              button(h, {
                label: icon(h, "pencil"),
                onClick: M.EditNote({ note }),
                size: "icon",
                variant: "ghost",
                attributes: [h.AriaLabel(`Edit ${note.title}`)],
              }),
              button(h, {
                label: icon(h, "trash-2"),
                onClick: M.DeleteNote({ note }),
                size: "icon",
                variant: "ghost",
                attributes: [h.AriaLabel(`Delete ${note.title}`)],
              }),
            ],
          }),
        ],
      ),
    ),
    ...(model.notes.error ? [alert(h, model.notes.error)] : []),
    ...(data?.nextCursor || model.notes.error
      ? [
          button(h, {
            label: model.notes.loading
              ? "Loading views…"
              : model.notes.error
                ? "Retry loading views"
                : "Load more views",
            onClick: M.LoadNotes({ more: !!data?.nextCursor }),
            busy: model.notes.loading,
            attributes: [h.Key("load-saved-views")],
            className: "w-full mt-2",
          }),
        ]
      : []),
    ...(model.noteError && !model.deleting ? [alert(h, model.noteError)] : []),
  ];
}

function savedViews(h: H, model: PickerModel) {
  const filters = filtersFromQuery(model.query) ?? {};
  const selected = appliedView(model, filters);
  return viewPicker(h, {
    model: model.picker,
    onMessage: (message) => M.SavedViewsPicker({ message }),
    label: "Saved views",
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
                ["Choose a view to apply its filters here."],
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
        [h.Class("view-picker-list")],
        [
          viewOption(h, {
            title: "All trips",
            accessibleLabel: "Show all trips",
            summary: h.span([h.Class("muted text-xs")], ["No filters applied"]),
            selected: !queryFor(filters) && !selected,
            onSelect: M.ClearView(),
          }),
          ...(model.notes.data
            ? [
                h.p(
                  [h.AriaLive("polite"), h.Class("view-picker-count")],
                  [
                    `${model.notes.data.rows.length} saved ${model.notes.data.rows.length === 1 ? "view" : "views"} shown`,
                  ],
                ),
              ]
            : []),
          ...savedViewList(h, model),
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
            onClick: M.NewNote(),
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
    model: model.dialogs.note,
    onMessage: (message) => M.NoteDialog({ message }),
    className: "workspace-dialog note-dialog",
    children: [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id(Dialog.titleId(model.dialogs.note))], [name]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            ["Give this view a name so you and your team can return to it."],
          ),
        ],
      ),
      h.form(
        [h.OnSubmit(M.SaveNote()), h.Class("p-6 space-y-5")],
        [
          field(h, {
            id: "note-title",
            label: "View name",
            value: draft.title,
            onInput: (value) => M.NoteChanged({ field: "title", value }),
            placeholder: "e.g. Midtown fare review",
            attributes: [h.Required(true), h.Maxlength(160)],
          }),
          h.div(
            [],
            [
              h.label(
                [h.For("note-body"), h.Class("field-label")],
                ["Finding (optional)"],
              ),
              Textarea.view(
                {
                  id: "note-body",
                  value: draft.body,
                  onInput: (value) => M.NoteChanged({ field: "body", value }),
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
            [h.Class("context")],
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
                onClick: M.CloseNote(),
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
    className: "workspace-dialog note-dialog",
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
      ...(model.noteError ? [alert(h, model.noteError)] : []),
      h.div(
        [h.Class("dialog-footer")],
        [
          button(h, {
            label: "Cancel",
            onClick: M.CloseDelete(),
            disabled: model.noteBusy,
          }),
          button(h, {
            label: model.noteBusy ? "Deleting…" : "Delete view",
            onClick: M.ConfirmDelete(),
            disabled: model.noteBusy,
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
