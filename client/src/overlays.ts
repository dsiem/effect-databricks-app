import { DialogMount } from "./browser";
import { Message as M } from "./message";
import type { Model } from "./model";
import { notebook } from "./pages";
import {
  alert,
  badge,
  button,
  type Child,
  error,
  filterSummary,
  type H,
  loading,
  money,
} from "./ui";

const close = (h: H, label = "Close") =>
  button(h, "×", M.CloseOverlay(), [
    h.AriaLabel(label),
    h.Class("btn ghost dialog-close"),
  ]);
export function savedViews(h: H, model: Model) {
  return h.dialog(
    [
      h.Key("saved-views"),
      h.Class("workspace-dialog sheet"),
      h.AriaLabelledBy("saved-views-title"),
      h.OnMount(DialogMount({ modal: true, focus: ".dialog-close" })),
    ],
    [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id("saved-views-title")], ["Saved views"]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            [
              "Shared findings and filters. Open a view to apply its filters here.",
            ],
          ),
        ],
      ),
      h.div([h.Class("sheet-body")], notebook(h, model, true)),
    ],
  );
}
export function editor(h: H, model: Model) {
  const editor = model.editor;
  if (!editor) return null;
  const { draft, view, saving } = editor;
  const name = view
    ? draft.version !== null
      ? "Edit saved view"
      : "Save this view"
    : draft.version !== null
      ? "Edit note"
      : "New note";
  return h.dialog(
    [
      h.Key(`note-${draft.id}`),
      h.Class("workspace-dialog note-dialog"),
      h.AriaLabelledBy("note-dialog-title"),
      h.OnMount(DialogMount({ modal: true, focus: "#note-title" })),
    ],
    [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id("note-dialog-title")], [name]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            [
              view
                ? "Give this view a name so you and your team can return to it."
                : "Save your findings with a snapshot of this Explore view.",
            ],
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
                [view ? "View name" : "Title"],
              ),
              h.input([
                h.Id("note-title"),
                h.Class("input mt-2"),
                h.Required(true),
                h.Maxlength(160),
                h.Value(draft.title),
                h.OnInput((value) => M.NoteChanged({ field: "title", value })),
                h.Placeholder(
                  view ? "e.g. Midtown fare review" : "Analysis title",
                ),
              ]),
            ],
          ),
          h.div(
            [],
            [
              h.label(
                [h.For("note-body"), h.Class("field-label")],
                [view ? "Finding (optional)" : "Your notes"],
              ),
              h.textarea([
                h.Id("note-body"),
                h.Class("input mt-2 min-h-28"),
                h.Maxlength(10000),
                h.Value(draft.body),
                h.OnInput((value) => M.NoteChanged({ field: "body", value })),
                h.Placeholder(
                  "What is worth returning to? Add context or a next step…",
                ),
              ]),
            ],
          ),
          h.div(
            [h.Class("context")],
            [
              h.p(
                [h.Class("text-sm font-medium mb-2")],
                [view ? "Applied filters" : "Saved Explore view"],
              ),
              filterSummary(h, draft.filters),
              h.p(
                [h.Class("muted text-xs leading-5 mt-3")],
                [
                  draft.version !== null
                    ? "This note keeps its original filters, even when your Explore view changes."
                    : "These filters are saved with your note so you can reopen this view later.",
                ],
              ),
            ],
          ),
          ...(editor.error ? [alert(h, editor.error)] : []),
          h.div(
            [h.Class("flex justify-end gap-2")],
            [
              button(h, "Cancel", M.CloseOverlay(), [h.Disabled(saving)]),
              h.button(
                [
                  h.Type("submit"),
                  h.Class("btn primary"),
                  h.Disabled(saving || !draft.title.trim()),
                ],
                [saving ? "Saving…" : view ? "Save view" : "Save note"],
              ),
            ],
          ),
        ],
      ),
    ],
  );
}
export function deleteDialog(h: H, model: Model) {
  return h.dialog(
    [
      h.Key("delete-note"),
      h.Class("workspace-dialog note-dialog"),
      h.AriaLabelledBy("delete-title"),
      h.OnMount(DialogMount({ modal: true, focus: "button" })),
    ],
    [
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id("delete-title")], ["Delete this note?"]),
          h.p(
            [h.Class("muted text-sm mt-2")],
            [
              `“${model.deleting?.title ?? ""}” will be removed from the shared notebook.`,
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
            model.noteBusy ? "Deleting…" : "Delete note",
            M.ConfirmDelete(),
            [h.Disabled(model.noteBusy)],
            "destructive",
          ),
        ],
      ),
    ],
  );
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
  return h.dialog(
    [
      h.Key(`trip-${trip.trip_id}`),
      h.Class("workspace-dialog sheet trip-inspector"),
      h.AriaLabelledBy("trip-details-title"),
      h.OnMount(DialogMount({ modal: true, focus: "#trip-details-title" })),
    ],
    [
      close(h),
      h.div(
        [h.Class("dialog-header")],
        [
          h.h2([h.Id("trip-details-title"), h.Tabindex(-1)], ["Trip details"]),
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
          h.textarea([
            h.Id("trip-comment"),
            h.Class("input min-h-24"),
            h.Maxlength(4000),
            h.Value(draft?.body ?? ""),
            h.OnInput((body) => M.CommentChanged({ body })),
            h.Placeholder("Share a finding or question…"),
          ]),
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
          h.button(
            [
              h.Type("submit"),
              h.Class("btn primary"),
              h.Disabled(!!model.posting || !draft?.id || !draft.body.trim()),
            ],
            [
              model.posting?.trip.trip_id === trip.trip_id
                ? "Posting…"
                : "Post comment",
            ],
          ),
        ],
      ),
    ],
  );
}
