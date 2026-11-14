import { Button, Dialog, Textarea } from "@foldkit/ui";
import { defineView } from "foldkit/submodel";
import { money } from "../../lib/format";
import { dialog } from "../../ui/dialog";
import { icon } from "../../ui/icons";
import {
  alert,
  badge,
  button,
  type Child,
  error,
  loading,
} from "../../ui/primitives";
import type { H } from "./view-messages";
import { Message as M } from "./view-messages";
import type { ViewModel as Model } from "./view-model";

const close = (h: H, label = "Close") =>
  button(h, {
    label: icon(h, "x"),
    onClick: M.CloseOverlay(),
    attributes: [h.AriaLabel(label)],
    className: " dialog-close",
    variant: "ghost",
  });
function inspector(h: H, model: Model) {
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
                  button(h, {
                    label: model.comments.loading
                      ? "Loading…"
                      : model.comments.error
                        ? "Retry loading comments"
                        : "Load older comments",
                    onClick: M.LoadComments({
                      more: !!model.comments.data?.nextCursor,
                    }),
                    attributes: [h.Disabled(model.comments.loading)],
                    className: " w-full mt-4",
                  }),
                ]
              : []),
          ];
  return dialog(h, {
    model: model.dialogs.trip,
    onMessage: (message) => M.Dialog({ id: "trip", message }),
    className: "workspace-dialog sheet trip-inspector",
    children: [
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
    ],
  });
}

export const inspectorView = defineView<Model, typeof M.Type>((model, h) =>
  inspector(h, model),
);
