import { Button, Dialog, Input, Textarea } from "@foldkit/ui";
import { icon } from "./icons";
import { Message as M } from "./message";
import type { Model } from "./model";
import {
  alert,
  badge,
  button,
  type Child,
  card,
  error,
  filterSummary,
  type H,
  loading,
  money,
} from "./ui";
import { dialog } from "./ui-dialog";

const close = (h: H, label = "Close") =>
  button(h, icon(h, "x"), M.CloseOverlay(), [
    h.AriaLabel(label),
    h.Class("btn ghost dialog-close"),
  ]);
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
                button(
                  h,
                  icon(h, note.pinned ? "pin" : "pin-off"),
                  M.PinNote({ note }),
                  [
                    h.AriaLabel(
                      `${note.pinned ? "Unpin" : "Pin"} ${note.title}`,
                    ),
                    h.Disabled(model.noteBusy),
                  ],
                  "ghost",
                ),
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
                button(
                  h,
                  "Open saved view",
                  M.RestoreView({ filters: note.filters }),
                  [
                    h.AriaLabel(`Open saved view for ${note.title}`),
                    h.Class("btn ghost mt-3"),
                  ],
                ),
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
                        button(
                          h,
                          icon(h, "pencil"),
                          M.EditNote({ note }),
                          [h.AriaLabel(`Edit ${note.title}`)],
                          "ghost",
                        ),
                        button(
                          h,
                          icon(h, "trash-2"),
                          M.DeleteNote({ note }),
                          [h.AriaLabel(`Delete ${note.title}`)],
                          "ghost",
                        ),
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
              button(
                h,
                model.notes.loading
                  ? "Loading views…"
                  : model.notes.error
                    ? "Retry loading views"
                    : "Load more views",
                M.LoadNotes({ more: !!data?.nextCursor }),
                [h.Disabled(model.notes.loading)],
              ),
            ],
          ),
        ]
      : []),
    ...(model.noteError && !model.deleting ? [alert(h, model.noteError)] : []),
  ];
}

export function savedViews(h: H, model: Model) {
  return dialog(h, model, "views", "workspace-dialog sheet", [
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
        button(h, "Save this view", M.NewNote(), [h.Class("btn outline mb-5")]),
        ...savedViewList(h, model),
      ],
    ),
  ]);
}
export function editor(h: H, model: Model) {
  const editor = model.editor;
  if (!editor) return null;
  const { draft, saving } = editor;
  const name = draft.version !== null ? "Edit saved view" : "Save this view";
  return dialog(h, model, "note", "workspace-dialog note-dialog", [
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
            button(h, "Cancel", M.CloseOverlay(), [h.Disabled(saving)]),
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
  ]);
}
export function deleteDialog(h: H, model: Model) {
  return dialog(h, model, "delete", "workspace-dialog note-dialog", [
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
        button(h, "Cancel", M.CloseOverlay(), [h.Disabled(model.noteBusy)]),
        button(
          h,
          model.noteBusy ? "Deleting…" : "Delete view",
          M.ConfirmDelete(),
          [h.Disabled(model.noteBusy)],
          "destructive",
        ),
      ],
    ),
  ]);
}
export function inspector(h: H, model: Model) {
  const trip = model.selectedTrip;
  if (!trip) return null;
  const draft = model.commentDrafts[trip.trip_id];
  const rows = model.comments.data?.rows ?? [];
  const info = (label: string, value: string) =>
    h.div(
      [],
      [
        h.dt([h.Class("muted text-xs")], [label]),
        h.dd([h.Class("text-sm mt-1")], [value]),
      ],
    );
  const comments: Child[] =
    model.comments.loading && !model.comments.data
      ? [loading(h, "Loading comments…")]
      : model.comments.error && !model.comments.data
        ? [error(h, model.comments.error, M.LoadComments({ more: false }))]
        : [
            ...(!rows.length
              ? [
                  h.div(
                    [h.Class("empty-comments")],
                    [
                      h.p(
                        [h.Class("text-sm font-medium")],
                        ["Start the conversation"],
                      ),
                      h.p(
                        [h.Class("muted text-xs leading-5 mt-2")],
                        [
                          "Flag an unusual fare, ask a question, or leave a next step for another analyst.",
                        ],
                      ),
                    ],
                  ),
                ]
              : []),
            h.ol(
              [h.AriaLabel("Trip comments"), h.Class("space-y-4")],
              rows.map((comment) =>
                h.li(
                  [h.Key(comment.id), h.Class("rounded-lg border p-4")],
                  [
                    h.div(
                      [
                        h.Class(
                          "flex flex-wrap justify-between gap-1 text-xs mb-2",
                        ),
                      ],
                      [
                        h.span(
                          [h.Class("font-medium")],
                          [comment.author?.name ?? "Workspace viewer"],
                        ),
                        h.time(
                          [h.Datetime(comment.created_at), h.Class("muted")],
                          [new Date(comment.created_at).toLocaleString()],
                        ),
                      ],
                    ),
                    h.p(
                      [
                        h.Class(
                          "whitespace-pre-wrap break-words text-sm leading-6",
                        ),
                      ],
                      [comment.body],
                    ),
                  ],
                ),
              ),
            ),
            ...(model.comments.error ? [alert(h, model.comments.error)] : []),
            ...(model.comments.data?.nextCursor || model.comments.error
              ? [
                  button(
                    h,
                    model.comments.loading
                      ? "Loading…"
                      : model.comments.error
                        ? "Retry loading comments"
                        : "Load older comments",
                    M.LoadComments({ more: !!model.comments.data?.nextCursor }),
                    [
                      h.Disabled(model.comments.loading),
                      h.Class("btn outline w-full mt-4"),
                    ],
                  ),
                ]
              : []),
          ];
  return dialog(h, model, "trip", "workspace-dialog sheet trip-inspector", [
    close(h),
    h.div(
      [h.Class("dialog-header")],
      [
        h.h2(
          [h.Id(Dialog.titleId(model.dialogs.trip)), h.Tabindex(-1)],
          ["Trip details"],
        ),
        h.p(
          [h.Class("muted text-sm mt-2")],
          ["Inspect the record and leave context for your team."],
        ),
      ],
    ),
    h.div(
      [h.Class("sheet-body")],
      [
        h.section(
          [h.AriaLabel("Selected trip"), h.Class("context mb-6")],
          [
            h.p(
              [h.Class("text-lg font-semibold mb-4")],
              [`${trip.pickup_zip} → ${trip.dropoff_zip}`],
            ),
            h.dl(
              [h.Class("grid gap-4")],
              [
                info("Pickup", trip.pickup_at),
                info("Drop-off", trip.dropoff_at),
                info("Fare", money(trip.fare, 2)),
                info(
                  "Distance · duration",
                  `${trip.distance.toFixed(2)} mi · ${trip.duration.toFixed(1)} min`,
                ),
              ],
            ),
          ],
        ),
        h.div(
          [h.Class("flex justify-between items-center mb-4")],
          [h.h2([], ["Comments"]), badge(h, "Shared with your team")],
        ),
        ...comments,
        h.p(
          [h.Class("muted text-xs mt-5")],
          ["Comments stay with this record across filters and sorting."],
        ),
      ],
    ),
    h.form(
      [h.Class("comment-composer"), h.OnSubmit(M.PostComment())],
      [
        h.label(
          [h.For("trip-comment"), h.Class("field-label")],
          ["Add a comment"],
        ),
        Textarea.view(
          {
            id: "trip-comment",
            value: draft?.body ?? "",
            onInput: (body) => M.CommentChanged({ body }),
            placeholder: "Share a finding or question…",
            toView: (attributes) =>
              h.textarea([
                ...attributes.textarea,
                h.Class("input min-h-24"),
                h.Maxlength(4000),
              ]),
          },
          h,
        ),
        ...(model.postError
          ? [
              alert(
                h,
                `${model.postError} Your draft is kept here. Retry when ready.`,
              ),
            ]
          : []),
        ...(model.posted === trip.trip_id
          ? [
              h.p(
                [h.Role("status"), h.Class("muted text-xs")],
                ["Comment posted"],
              ),
            ]
          : []),
        Button.view(
          {
            type: "submit",
            isDisabled: !!model.posting || !draft?.id || !draft.body.trim(),
            toView: (attributes) =>
              h.button(
                [...attributes.button, h.Class("btn primary")],
                [
                  model.posting?.trip.trip_id === trip.trip_id
                    ? "Posting…"
                    : "Post comment",
                ],
              ),
          },
          h,
        ),
      ],
    ),
  ]);
}
