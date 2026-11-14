import { Button, Dialog, Textarea } from "@foldkit/ui";
import { Option } from "effect";
import { Lexer, type MarkedToken, type Token } from "marked";
import type { GenieReply } from "../../../../shared/domain";
import { Message as M } from "../../app/message";
import {
  busy,
  filtersFromQuery,
  type Model,
  pageContext,
} from "../../app/model";
import type { H } from "../../app/view-types";
import { dialog } from "../../ui/dialog";
import { icon } from "../../ui/icons";
import { alert, button, type Child, table } from "../../ui/primitives";
import { filterSummary } from "../filters/summary";
import { PanelReturnFocus } from "./focus";

// Render Markdown as VNodes. Raw HTML is text and link protocols are constrained.
function markdown(h: H, tokens: Token[]): Child[] {
  const nested = (token: { tokens?: Token[]; text?: string }) =>
    token.tokens ? markdown(h, token.tokens) : [token.text ?? ""];
  return tokens.flatMap((raw): Child[] => {
    const token = raw as MarkedToken;
    switch (token.type) {
      case "space":
        return [];
      case "paragraph":
        return [h.p([], nested(token))];
      case "heading":
        return [h.h3([], nested(token))];
      case "text":
        return nested(token);
      case "strong":
        return [h.strong([], nested(token))];
      case "em":
        return [h.em([], nested(token))];
      case "del":
        return [h.del([], nested(token))];
      case "codespan":
        return [h.code([], [token.text])];
      case "code":
        return [h.pre([], [h.code([], [token.text])])];
      case "blockquote":
        return [h.blockquote([], markdown(h, token.tokens))];
      case "list":
        return [
          token.ordered
            ? h.ol(
                [],
                token.items.map((item) => h.li([], markdown(h, item.tokens))),
              )
            : h.ul(
                [],
                token.items.map((item) => h.li([], markdown(h, item.tokens))),
              ),
        ];
      case "link":
        return [
          /^(https?:|mailto:|\/|#)/i.test(token.href) &&
          !token.href.startsWith("//")
            ? h.a(
                [h.Href(token.href), h.Rel("noopener noreferrer")],
                nested(token),
              )
            : h.span([], nested(token)),
        ];
      case "br":
        return [h.br([])];
      case "hr":
        return [h.hr([])];
      case "table":
        return [
          table(
            h,
            token.header.map((cell) => cell.text),
            token.rows.map((row) =>
              row.map((cell) => h.span([], markdown(h, cell.tokens))),
            ),
          ),
        ];
      default:
        return ["text" in token ? String(token.text) : token.raw];
    }
  });
}
const questions = {
  overview: [
    "Explain the main patterns in this view.",
    "Compare weekday and weekend trip activity.",
    "Which pickup hours have the highest average fare?",
  ],
  trips: [
    "Summarize the trips shown here.",
    "Find unusually high fares in the filtered dataset.",
    "Compare average fare by trip distance.",
  ],
  map: [
    "Explain the pickup distribution in this view.",
    "Compare the busiest pickup ZIP codes.",
    "Which pickup areas have the highest average fare?",
  ],
  notebook: [
    "Summarize trip activity for the current filters.",
    "Compare weekday and weekend fares.",
  ],
  genie: [
    "Which pickup ZIP codes have the most trips?",
    "How does the average fare change by hour of day?",
    "Show total trips and fare revenue by month.",
  ],
};
function answer(h: H, model: Model, reply: GenieReply): Child[] {
  return [
    h.div(
      [h.Class("markdown")],
      markdown(h, Lexer.lex(reply.text || "Query results")),
    ),
    ...reply.queries.map((result) =>
      h.div(
        [h.Class("query-result")],
        [
          h.p(
            [h.Class("text-xs font-medium px-3 py-2 border-b bg-muted/50")],
            [result.description],
          ),
          h.div(
            [h.Class("max-h-72 overflow-auto")],
            [
              table(
                h,
                [...result.columns],
                result.rows.map((row) => row.map((cell) => cell ?? "—")),
              ),
            ],
          ),
          ...(result.truncated
            ? [
                h.p(
                  [h.Class("border-t px-3 py-2 text-xs muted")],
                  ["Showing a bounded preview of the query result."],
                ),
              ]
            : []),
          h.details(
            [h.Class("border-t p-3")],
            [
              h.summary(
                [h.Class("text-xs font-medium cursor-pointer")],
                ["View generated SQL"],
              ),
              h.pre(
                [
                  h.Class(
                    "mt-3 whitespace-pre-wrap break-all text-xs leading-5 muted",
                  ),
                ],
                [result.sql],
              ),
              button(h, {
                label: model.clipboard === "Copied" ? "Copied" : "Copy SQL",
                onClick: M.CopySql({ sql: result.sql }),
                className: " mt-2",
                variant: "ghost",
              }),
              ...(model.clipboard && model.clipboard !== "Copied"
                ? [alert(h, model.clipboard)]
                : []),
            ],
          ),
        ],
      ),
    ),
  ];
}
export function genie(h: H, model: Model, floating = false) {
  const context = model.genieSelection ?? pageContext(model);
  const filters = filtersFromQuery(model.query);
  const enabled = !!model.status.data?.genie && !!filters;
  const working = busy(model);
  const content: Child[] = [
    h.div(
      [h.Class("genie-header")],
      [
        h.div(
          [h.Class("flex items-center gap-3")],
          [
            h.span([h.Class("brand-icon")], [icon(h, "sparkles")]),
            h.div(
              [],
              [
                h.h2(
                  [
                    h.Id(
                      floating && model.mobile
                        ? Dialog.titleId(model.dialogs.genie)
                        : "genie-title",
                    ),
                  ],
                  ["Genie"],
                ),
                h.p([h.Class("muted text-xs")], ["Your data, in context"]),
              ],
            ),
          ],
        ),
        h.div(
          [h.Class("flex items-center gap-1")],
          [
            button(h, {
              label: icon(h, "plus"),
              onClick: M.NewConversation(),
              attributes: [
                h.AriaLabel("New conversation"),
                h.Disabled(working || !model.turns.length),
              ],
              variant: "ghost",
            }),
            ...(floating
              ? [
                  button(h, {
                    label: icon(
                      h,
                      model.genieExpanded ? "minimize-2" : "maximize-2",
                    ),
                    onClick: M.ExpandGenie(),
                    attributes: [
                      h.AriaLabel(
                        model.genieExpanded ? "Minimize Genie" : "Expand Genie",
                      ),
                    ],
                    className: " hidden md:inline-flex",
                    variant: "ghost",
                  }),
                  button(h, {
                    label: icon(h, "x"),
                    onClick: M.CloseOverlay(),
                    attributes: [h.AriaLabel("Close Genie")],
                    variant: "ghost",
                  }),
                ]
              : []),
          ],
        ),
      ],
    ),
    h.section(
      [
        h.AriaLabel("Explore view for your next question"),
        h.Class("genie-context"),
      ],
      [
        h.div(
          [h.Class("flex items-center justify-between gap-2 mb-2")],
          [
            h.div(
              [],
              [
                h.p(
                  [h.Class("muted text-[10px] uppercase tracking-widest mb-1")],
                  ["Looking at"],
                ),
                h.h3([h.Class("text-sm font-medium")], [context.title]),
              ],
            ),
            ...(model.genieSelection
              ? [
                  button(h, {
                    label: icon(h, "x"),
                    onClick: M.ClearSelection(),
                    attributes: [h.AriaLabel("Use whole page")],
                    variant: "ghost",
                  }),
                ]
              : []),
          ],
        ),
        ...(filters
          ? [filterSummary(h, filters)]
          : [alert(h, "Correct the page filters before asking Genie.")]),
        h.p(
          [h.Class("muted text-[11px] leading-4 mt-2")],
          [
            `${context.data ? "Displayed data and applied filters included." : "Applied filters included."} Earlier answers keep their original view.`,
          ],
        ),
      ],
    ),
    h.div(
      [h.Class("genie-messages")],
      [
        ...(model.persistenceError ? [alert(h, model.persistenceError)] : []),
        ...(model.status.loading
          ? [h.p([h.Class("muted text-sm")], ["Connecting to Genie…"])]
          : model.status.error
            ? [alert(h, `Unable to connect to Genie. ${model.status.error}`)]
            : !model.status.data?.genie
              ? [
                  h.div(
                    [h.Class("py-5")],
                    [
                      h.h3([], ["Connect Genie to explore further"]),
                      h.p(
                        [h.Class("muted text-sm leading-6 mt-2")],
                        [
                          "Configure a Databricks Genie space for this workspace to ask questions about your taxi data.",
                        ],
                      ),
                    ],
                  ),
                ]
              : []),
        ...(!model.turns.length && enabled
          ? [
              h.h3(
                [h.Class("text-lg font-semibold")],
                ["Go deeper into this view"],
              ),
              h.p(
                [h.Class("muted text-sm leading-6 mt-2 mb-5")],
                [
                  "Explain what you’re seeing or ask Genie to run another analysis.",
                ],
              ),
              h.div(
                [h.Class("space-y-2 mb-5")],
                questions[context.page].map((question) =>
                  button(h, {
                    label: question,
                    onClick: M.SendQuestion({ question }),
                    className: " suggestion",
                  }),
                ),
              ),
            ]
          : []),
        h.div(
          [h.AriaLive("polite"), h.Class("space-y-6")],
          model.turns.map((turn) =>
            h.div(
              [h.Key(turn.id)],
              [
                h.div(
                  [h.Class("question-bubble")],
                  [
                    h.p([], [turn.question]),
                    ...(turn.context && turn.filters
                      ? [
                          h.details(
                            [h.Class("text-xs muted mt-2")],
                            [
                              h.summary(
                                [h.Class("cursor-pointer")],
                                [`${turn.context.title} · View context`],
                              ),
                              h.div(
                                [h.Class("mt-2")],
                                [filterSummary(h, turn.filters)],
                              ),
                            ],
                          ),
                        ]
                      : []),
                  ],
                ),
                h.p(
                  [
                    h.Class(
                      "text-xs font-semibold mb-2 flex items-center gap-2",
                    ),
                  ],
                  [icon(h, "sparkles"), "Genie"],
                ),
                ...(turn.state === "complete"
                  ? answer(h, model, turn.reply)
                  : "error" in turn
                    ? [
                        alert(h, turn.error),
                        ...(turn.state === "submission-rejected"
                          ? [
                              button(h, {
                                label: "Edit question",
                                onClick: M.EditQuestion({
                                  question: turn.question,
                                }),
                                attributes: [h.Disabled(working)],
                                className: " mt-3",
                              }),
                            ]
                          : turn.state === "paused"
                            ? [
                                button(h, {
                                  label:
                                    turn.stage === "retrieving"
                                      ? "Retry result download"
                                      : "Resume answer",
                                  onClick: M.ResumeTurn({ id: turn.id }),
                                  attributes: [h.Disabled(working)],
                                  className: " mt-3",
                                }),
                              ]
                            : []),
                      ]
                    : [
                        h.p(
                          [h.Class("muted text-sm py-2")],
                          ["Processing query…"],
                        ),
                      ]),
              ],
            ),
          ),
        ),
      ],
    ),
    h.div(
      [h.Class("genie-composer")],
      [
        h.form(
          [h.OnSubmit(M.SendQuestion({ question: model.genieDraft }))],
          [
            Textarea.view(
              {
                id: "genie-composer",
                placeholder: "Ask about this view…",
                value: model.genieDraft,
                isDisabled: !enabled,
                onInput: (value) => M.GenieDraft({ value }),
                toView: (attributes) =>
                  h.textarea([
                    ...attributes.textarea,
                    h.AriaLabel("Ask a question about taxi data"),
                    h.Maxlength(3500),
                    h.OnKeyDownPreventDefault((key, modifiers) =>
                      key === "Enter" && !modifiers.shiftKey
                        ? Option.some(
                            M.SendQuestion({ question: model.genieDraft }),
                          )
                        : Option.none(),
                    ),
                  ]),
              },
              h,
            ),
            h.div(
              [h.Class("flex items-center justify-between gap-2 mt-2")],
              [
                h.span(
                  [h.Class("muted text-[11px]")],
                  [
                    working
                      ? "Working on your question…"
                      : "Enter to send · Shift + Enter for a new line",
                  ],
                ),
                Button.view(
                  {
                    type: "submit",
                    isDisabled: !enabled || working || !model.genieDraft.trim(),
                    toView: (attributes) =>
                      h.button(
                        [
                          ...attributes.button,
                          h.Class("btn primary"),
                          h.AriaLabel("Send question"),
                        ],
                        [icon(h, "arrow-up")],
                      ),
                  },
                  h,
                ),
              ],
            ),
          ],
        ),
        h.p(
          [h.Class("muted text-[10px] text-center mt-2")],
          ["Genie can make mistakes. Check the SQL and results."],
        ),
      ],
    ),
  ];
  if (!floating) return h.div([h.Class("genie-full")], content);
  const classes = `genie-panel ${model.genieExpanded ? "expanded" : ""}`;
  if (model.mobile)
    return dialog(h, {
      model: model.dialogs.genie,
      onMessage: (message) => M.Dialog({ id: "genie", message }),
      className: classes,
      children: content,
    });
  // The desktop helper stays non-modal so the user can explore alongside it.
  return h.dialog(
    [
      h.Key("genie-helper"),
      h.OnMount(PanelReturnFocus()),
      h.Open(true),
      h.AriaLabelledBy("genie-title"),
      h.Class(classes),
      h.OnKeyDownPreventDefault((key) =>
        key === "Escape" ? Option.some(M.CloseOverlay()) : Option.none(),
      ),
    ],
    content,
  );
}
