import { Button, Dialog, Input, Textarea } from "@foldkit/ui";
import { Message as M } from "../../app/message";
import type { Model } from "../../app/model";
import type { H } from "../../app/view-types";
import { dialog } from "../../ui/dialog";
import { icon } from "../../ui/icons";
import {
  alert,
  button,
  type Child,
  card,
  error,
  loading,
} from "../../ui/primitives";
import { filterSummary } from "../filters/summary";

const close = (h: H, label = "Close") =>
  button(h, {
    label: icon(h, "x"),
    onClick: M.CloseOverlay(),
    attributes: [h.AriaLabel(label)],
    className: " dialog-close",
    variant: "ghost",
  });
function savedViewList(h: H, model: Model): Child[] {
  const data = model.notes.data;
  if (model.notes.loading && !data) return [loading(h, "Loading saved views…")];
  if (model.notes.error && !data)
    return [error(h, model.notes.error, M.LoadNotes({ more: false }))];
  const rows = data?.rows ?? [];
  if (!rows.length)
    return [
      card(
        h,
        [
          h.h2([], ["No saved views"]),
          h.p(
            [h.Class("muted text-sm mt-2 mb-6")],
            [
              "Save the current Explore filters as a named view to return to later.",
            ],
          ),
        ],
        "empty-state",
      ),
    ];
  return [
    h.p(
      [h.AriaLive("polite"), h.Class("muted text-sm mb-4")],
      [
        `${rows.length} saved ${rows.length === 1 ? "view" : "views"} shown · shared across this app`,
      ],
    ),
    h.div(
      [h.Class("grid gap-4")],
      rows.map((note) =>
        card(
          h,
          [
            h.div(
              [h.Class("flex gap-3 mb-4 items-start")],
              [
                h.h2([h.Class("flex-1 min-w-0 break-words")], [note.title]),
                button(h, {
                  label: icon(h, note.pinned ? "pin" : "pin-off"),
                  onClick: M.PinNote({ note }),
                  attributes: [
                    h.AriaLabel(
                      `${note.pinned ? "Unpin" : "Pin"} ${note.title}`,
                    ),
                    h.Disabled(model.noteBusy),
                  ],
                  variant: "ghost",
                }),
              ],
            ),
            h.p(
              [
                h.Class(
                  "whitespace-pre-wrap break-words muted text-sm leading-6 mb-5",
                ),
              ],
              [note.body || "No additional details."],
            ),
            h.div(
              [h.Class("mt-auto")],
              [
                h.p([h.Class("muted text-xs mb-2")], ["Filters"]),
                filterSummary(h, note.filters),
                button(h, {
                  label: "Open saved view",
                  onClick: M.RestoreView({ filters: note.filters }),
                  attributes: [
                    h.AriaLabel(`Open saved view for ${note.title}`),
                  ],
                  className: " mt-3",
                  variant: "ghost",
                }),
                h.div(
                  [
                    h.Class(
                      "border-t pt-4 mt-4 flex items-center justify-between gap-2",
                    ),
                  ],
                  [
                    h.span(
                      [h.Class("muted text-xs")],
                      [
                        `Updated ${new Date(note.updated_at).toLocaleDateString()}`,
                      ],
                    ),
                    h.div(
                      [h.Class("flex")],
                      [
                        button(h, {
                          label: icon(h, "pencil"),
                          onClick: M.EditNote({ note }),
                          attributes: [h.AriaLabel(`Edit ${note.title}`)],
                          variant: "ghost",
                        }),
                        button(h, {
                          label: icon(h, "trash-2"),
                          onClick: M.DeleteNote({ note }),
                          attributes: [h.AriaLabel(`Delete ${note.title}`)],
                          variant: "ghost",
                        }),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
          "p-6 flex flex-col",
        ),
      ),
    ),
    ...(model.notes.error ? [alert(h, model.notes.error)] : []),
    ...(data?.nextCursor || model.notes.error
      ? [
          h.div(
            [h.Class("flex justify-center mt-6")],
            [
              button(h, {
                label: model.notes.loading
                  ? "Loading views…"
                  : model.notes.error
                    ? "Retry loading views"
                    : "Load more views",
                onClick: M.LoadNotes({ more: !!data?.nextCursor }),
                attributes: [h.Disabled(model.notes.loading)],
              }),
            ],
          ),
        ]
      : []),
    ...(model.noteError && !model.deleting ? [alert(h, model.noteError)] : []),
  ];
}

export function savedViews(h: H, model: Model) {
  return dialog(h, {
    model: model.dialogs.views,
    onMessage: (message) => M.Dialog({ id: "views", message }),
    className: "workspace-dialog sheet",
    children: [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id(Dialog.titleId(model.dialogs.views))], ["Saved views"]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            [
              "Shared findings and filters. Open a view to apply its filters here.",
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("sheet-body")],
        [
          button(h, {
            label: "Save this view",
            onClick: M.NewNote(),
            className: " mb-5",
          }),
          ...savedViewList(h, model),
        ],
      ),
    ],
  });
}
export function editor(h: H, model: Model) {
  const editor = model.editor;
  if (!editor) return null;
  const { draft, saving } = editor;
  const name = draft.version !== null ? "Edit saved view" : "Save this view";
  return dialog(h, {
    model: model.dialogs.note,
    onMessage: (message) => M.Dialog({ id: "note", message }),
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
          h.div(
            [],
            [
              h.label(
                [h.For("note-title"), h.Class("field-label")],
                ["View name"],
              ),
              Input.view(
                {
                  id: "note-title",
                  value: draft.title,
                  onInput: (value) => M.NoteChanged({ field: "title", value }),
                  placeholder: "e.g. Midtown fare review",
                  toView: (attributes) =>
                    h.input([
                      ...attributes.input,
                      h.Class("input mt-2"),
                      h.Required(true),
                      h.Maxlength(160),
                    ]),
                },
                h,
              ),
            ],
          ),
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
                onClick: M.CloseOverlay(),
                attributes: [h.Disabled(saving)],
              }),
              Button.view(
                {
                  type: "submit",
                  isDisabled: saving || !draft.title.trim(),
                  toView: (attributes) =>
                    h.button(
                      [...attributes.button, h.Class("btn primary")],
                      [saving ? "Saving…" : "Save view"],
                    ),
                },
                h,
              ),
            ],
          ),
        ],
      ),
    ],
  });
}
export function deleteDialog(h: H, model: Model) {
  return dialog(h, {
    model: model.dialogs.delete,
    onMessage: (message) => M.Dialog({ id: "delete", message }),
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
            onClick: M.CloseOverlay(),
            attributes: [h.Disabled(model.noteBusy)],
          }),
          button(h, {
            label: model.noteBusy ? "Deleting…" : "Delete view",
            onClick: M.ConfirmDelete(),
            attributes: [h.Disabled(model.noteBusy)],
            variant: "destructive",
          }),
        ],
      ),
    ],
  });
}
