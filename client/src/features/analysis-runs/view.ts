import { Option } from "effect";
import { AsyncData } from "foldkit";
import { defineView } from "foldkit/submodel";
import type {
  AnalysisRunState,
  RouteReliabilityReport,
  RouteReliabilityRow,
} from "../../../../shared/analysis-runs";
import { number } from "../../lib/format";
import { dateField } from "../../ui/date-field";
import { field } from "../../ui/field";
import {
  alert,
  button,
  card,
  type H as Builder,
  panelHeader,
  table,
  title,
} from "../../ui/primitives";
import { Message as M, type Message } from "./messages";
import { type Model, runHref, type WeekField } from "./model";

type H = Builder<Message>;
type ViewInputs = { readonly query: string };

const states = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
  unknown: "Status unavailable",
} satisfies Record<AnalysisRunState, string>;

const bands = {
  overnight: "00:00–06:00",
  morning: "06:00–12:00",
  afternoon: "12:00–18:00",
  evening: "18:00–00:00",
} satisfies Record<typeof RouteReliabilityRow.Type.timeBand, string>;

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const change = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const status = (h: H, state: AnalysisRunState) =>
  h.span(
    [h.Class("analysis-status"), h.DataAttribute("state", state)],
    [states[state]],
  );

const duration = (start: number, end: number) => {
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function setup(h: H, model: Model) {
  const busy = model.submission._tag === "Submitting";
  const week = (
    key: WeekField,
    id: string,
    label: string,
    calendarLabel: string,
  ) =>
    dateField(h, {
      id,
      label,
      calendarLabel,
      value: model.draft[key],
      model: model.datePickers?.[key] ?? null,
      onInput: (value) => M.AnalysisFieldChanged({ field: key, value }),
      onMessage: (message) => M.AnalysisDatePicker({ field: key, message }),
    });

  return card(h, [
    panelHeader(h, {
      title: "Route reliability",
      description:
        "Compare 90th-percentile trip times for the same ZIP pair and pickup time band. Each window covers seven days.",
    }),
    h.form(
      [
        h.Class("analysis-form"),
        h.Novalidate(true),
        h.OnSubmit(M.StartAnalysis()),
      ],
      [
        h.fieldset(
          [h.Class("filter-controls"), h.Disabled(busy)],
          [
            h.div(
              [h.Class("filter-fields")],
              [
                week(
                  "baselineWeek",
                  "analysis-baseline-week",
                  "Baseline week starts",
                  "Choose baseline week start",
                ),
                week(
                  "comparisonWeek",
                  "analysis-comparison-week",
                  "Comparison week starts",
                  "Choose comparison week start",
                ),
                field(h, {
                  id: "analysis-minimum-trips",
                  label: "Minimum trips per week",
                  type: "number",
                  value: model.draft.minimumTrips,
                  onInput: (value) =>
                    M.AnalysisFieldChanged({ field: "minimumTrips", value }),
                  attributes: [h.Min("1"), h.Step("1"), h.Required(true)],
                }),
              ],
            ),
            h.div(
              [h.Class("filter-actions")],
              [
                button(h, {
                  label: busy
                    ? "Starting…"
                    : model.submission.retryId
                      ? "Retry submission"
                      : "Run analysis",
                  type: "submit",
                  variant: "primary",
                  disabled: busy,
                }),
              ],
            ),
          ],
        ),
        ...(!busy && model.submission.error
          ? [alert(h, model.submission.error)]
          : []),
      ],
    ),
  ]);
}

function recentRuns(h: H, model: Model, query: string) {
  const data = Option.getOrUndefined(AsyncData.getData(model.recent));
  const error = Option.getOrUndefined(AsyncData.getError(model.recent));
  const loading = AsyncData.isPending(model.recent);
  return card(h, [
    panelHeader(h, {
      title: "Recent runs",
      actions: [
        button(h, {
          label: "Refresh",
          size: "small",
          variant: "ghost",
          onClick: M.RefreshAnalysisHistory(),
          busy: loading,
        }),
      ],
    }),
    ...(error
      ? [h.div([h.Class("analysis-panel-body")], [alert(h, error)])]
      : []),
    ...(data?.length
      ? [
          h.ul(
            [h.Class("analysis-history")],
            data.map((run) => {
              const current = model.selected?.id === run.id;
              const latest = current
                ? (model.selected?.detail.data ?? run)
                : run;
              return h.li(
                [h.Key(String(run.id))],
                [
                  h.a(
                    [
                      h.Href(runHref(run.id, query)),
                      h.Class("analysis-history-link"),
                      ...(current ? [h.AriaCurrent("page")] : []),
                    ],
                    [
                      h.span(
                        [],
                        [
                          h.span(
                            [h.Class("font-semibold")],
                            [`Run #${run.id}`],
                          ),
                          h.span(
                            [h.Class("analysis-detail")],
                            [
                              latest.startedAt === null
                                ? "Start time unavailable"
                                : dateTime.format(latest.startedAt),
                            ],
                          ),
                        ],
                      ),
                      status(h, latest.state),
                    ],
                  ),
                ],
              );
            }),
          ),
        ]
      : error
        ? []
        : [
            h.p(
              [h.Class("analysis-panel-body muted text-sm"), h.Role("status")],
              [loading ? "Loading recent runs…" : "No runs yet."],
            ),
          ]),
  ]);
}

function reportTable(h: H, report: typeof RouteReliabilityReport.Type) {
  if (!report.rows.length) {
    return h.p(
      [h.Class("analysis-panel-body muted text-sm")],
      ["No routes met the minimum trip count in both weeks."],
    );
  }
  const metric = (minutes: number, trips: number) =>
    h.div(
      [],
      [
        h.span(
          [h.Class("font-semibold tabular-nums")],
          [`${minutes.toFixed(1)} min`],
        ),
        h.span([h.Class("analysis-detail")], [`${number(trips)} trips`]),
      ],
    );
  return h.div(
    [h.Class("analysis-report-table")],
    [
      table(h, {
        caption:
          "Route reliability by pickup ZIP, drop-off ZIP, and pickup time",
        headers: [
          "Pickup → Drop-off",
          "Baseline p90",
          "Comparison p90",
          "Change",
        ],
        rows: report.rows.map((row) => {
          const delta = row.comparisonP90Minutes - row.baselineP90Minutes;
          return {
            key: `${row.pickupZip}-${row.dropoffZip}-${row.timeBand}`,
            cells: [
              h.div(
                [],
                [
                  h.span(
                    [h.Class("font-semibold")],
                    [`${row.pickupZip} → ${row.dropoffZip}`],
                  ),
                  h.span([h.Class("analysis-detail")], [bands[row.timeBand]]),
                ],
              ),
              metric(row.baselineP90Minutes, row.baselineCount),
              metric(row.comparisonP90Minutes, row.comparisonCount),
              h.span(
                [
                  h.Class(
                    `font-semibold tabular-nums ${delta > 0 ? "error-text" : ""}`,
                  ),
                ],
                [`${change.format(delta)} min`],
              ),
            ],
          };
        }),
      }),
    ],
  );
}

function selectedRun(
  h: H,
  model: Model,
  selected: NonNullable<Model["selected"]>,
) {
  const { detail, report } = selected;
  const run = detail.data;
  const input = report.data?.input ?? run?.input;
  const terminal =
    run?.state === "succeeded" ||
    run?.state === "failed" ||
    run?.state === "canceled";
  return card(h, [
    panelHeader(h, {
      title: `Run #${selected.id}`,
      ...(input
        ? {
            description: `${input.baselineWeek} vs ${input.comparisonWeek} · At least ${number(input.minimumTrips)} trips per week`,
          }
        : {}),
      actions:
        terminal && input
          ? [
              button(h, {
                label: "Run again with these inputs",
                size: "small",
                onClick: M.ReuseAnalysisInputs({ input }),
                disabled: model.submission._tag === "Submitting",
              }),
            ]
          : [],
    }),
    h.div(
      [h.Class("analysis-run-status")],
      [
        h.div(
          [h.Role("status")],
          [
            run
              ? status(h, run.state)
              : detail.loading
                ? "Checking status…"
                : "Status unavailable",
          ],
        ),
        ...(run && run.startedAt !== null
          ? [
              h.span(
                [h.Class("muted text-xs tabular-nums")],
                [
                  `Elapsed ${duration(run.startedAt, run.endedAt ?? selected.observedAt)}`,
                ],
              ),
            ]
          : []),
        ...((!run && detail.error) || run?.state === "unknown"
          ? [
              button(h, {
                label: "Check status",
                onClick: M.RetryAnalysisStatus(),
                size: "small",
                busy: detail.loading,
              }),
            ]
          : []),
      ],
    ),
    ...(detail.error
      ? [h.div([h.Class("analysis-panel-body")], [alert(h, detail.error)])]
      : []),
    ...(run?.reason
      ? [h.p([h.Class("analysis-panel-body muted text-sm")], [run.reason])]
      : []),
    ...(report.loading
      ? [
          h.p(
            [h.Class("analysis-panel-body muted text-sm"), h.Role("status")],
            ["Loading report…"],
          ),
        ]
      : []),
    ...(report.error
      ? [
          h.div(
            [h.Class("analysis-panel-body space-y-3")],
            [
              alert(h, report.error),
              button(h, {
                label: "Retry report",
                onClick: M.RetryAnalysisReport(),
                size: "small",
              }),
            ],
          ),
        ]
      : []),
    ...(report.data
      ? [
          panelHeader(h, {
            title: "Route changes",
            description:
              "Up to 50 routes ranked by the size of the change in p90 trip time. A p90 trip time is the time within which 90% of trips finish.",
          }),
          reportTable(h, report.data),
        ]
      : []),
  ]);
}

export const analysisRunsView = defineView<Model, Message, ViewInputs>(
  (model, { query }, h) =>
    h.div(
      [h.Class("contents")],
      [
        title(
          h,
          "Analysis runs",
          "Start a route comparison and return to its report when it finishes.",
        ),
        h.div(
          [h.Class("analysis-grid")],
          [
            h.div(
              [h.Class("analysis-main")],
              [
                setup(h, model),
                ...(model.invalidLink
                  ? [
                      card(
                        h,
                        [
                          alert(
                            h,
                            "This run link is invalid. Choose a recent run or start a new one.",
                          ),
                        ],
                        "analysis-panel-body",
                      ),
                    ]
                  : []),
                ...(model.selected
                  ? [selectedRun(h, model, model.selected)]
                  : []),
              ],
            ),
            recentRuns(h, model, query),
          ],
        ),
      ],
    ),
);
