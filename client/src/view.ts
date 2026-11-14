import { Button, Input, Tooltip } from "@foldkit/ui";
import type { Document } from "foldkit/html";
import { calendar } from "./calendar";
import { genie } from "./genie";
import { icon } from "./icons";
import { Message as M } from "./message";
import {
  filterError,
  filtersFromQuery,
  href,
  type Model,
  navigation,
} from "./model";
import { deleteDialog, editor, inspector, savedViews } from "./overlays";
import { overview, pickupMap, trips } from "./pages";
import { button, type Child, card, dateLabel, type H } from "./ui";
import { dialog } from "./ui-dialog";
import { initTooltip } from "./ui-state";

function sidebar(h: H, model: Model) {
  const user = model.user;
  const initials =
    user?.name
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "";
  const tooltip = (
    id: string,
    text: string,
    render: (attrs: import("foldkit/html").ChildAttribute[]) => Child,
  ) => {
    if (model.sidebar || model.mobile) return render([]);
    return h.submodel({
      slotId: `tooltip-${id}`,
      view: Tooltip.view,
      model: model.tooltips[id] ?? initTooltip(id),
      toParentMessage: (message) => M.Tooltip({ id, message }),
      viewInputs: {
        anchor: { placement: "right", gap: 8 },
        toView: ({ trigger, panel, isVisible }) =>
          h.div(
            [h.Class("tooltip-anchor")],
            [
              render([...trigger]),
              ...(isVisible
                ? [h.div([...panel, h.Class("nav-tooltip")], [text])]
                : []),
            ],
          ),
      },
    });
  };
  return h.nav(
    [
      h.Id("main-navigation"),
      h.AriaLabel("Main navigation"),
      h.Class(`sidebar ${!model.sidebar && !model.mobile ? "collapsed" : ""}`),
    ],
    [
      h.a(
        [h.Href(href("/", model.query)), h.Class("sidebar-brand")],
        [
          h.span([h.Class("brand-icon")], [icon(h, "car-taxi-front")]),
          h.div(
            [h.Class("sidebar-label")],
            [
              h.p([h.Class("font-semibold text-sm")], ["NYC Taxi"]),
              h.p([h.Class("muted text-xs")], ["Analytics workspace"]),
            ],
          ),
        ],
      ),
      ...(model.mobile
        ? [
            button(h, icon(h, "x"), M.CloseOverlay(), [
              h.AriaLabel("Close navigation"),
              h.Class("btn ghost absolute right-2 top-4"),
            ]),
          ]
        : []),
      h.div(
        [h.Class("sidebar-group")],
        [
          ...navigation.map((item) =>
            tooltip(item.path, item.label, (attrs) =>
              h.a(
                [
                  h.Href(href(item.path, model.query)),
                  h.Class(
                    `nav-link ${model.path === item.path ? "active" : ""}`,
                  ),
                  h.AriaLabel(item.label),
                  ...(model.path === item.path ? [h.AriaCurrent("page")] : []),
                  ...attrs,
                ],
                [
                  h.span([h.Class("nav-icon")], [icon(h, item.icon)]),
                  h.span([h.Class("sidebar-label")], [item.label]),
                ],
              ),
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("sidebar-bottom")],
        [
          ...(user
            ? [
                tooltip(
                  "profile",
                  `${user.name}${user.email ? ` · ${user.email}` : ""}`,
                  (attrs) =>
                    h.div(
                      [
                        ...attrs,
                        h.Tabindex(0),
                        h.AriaLabel(`Signed in as ${user.name}`),
                        h.Class("profile"),
                      ],
                      [
                        h.span([h.Class("avatar")], [initials]),
                        h.div(
                          [h.Class("sidebar-label min-w-0")],
                          [
                            h.p(
                              [h.Class("text-sm font-medium truncate")],
                              [user.name],
                            ),
                            ...(user.email
                              ? [
                                  h.p(
                                    [h.Class("muted text-xs truncate")],
                                    [user.email],
                                  ),
                                ]
                              : []),
                          ],
                        ),
                      ],
                    ),
                ),
              ]
            : []),
        ],
      ),
    ],
  );
}
function filters(h: H, model: Model) {
  const date = dateLabel({
    ...(model.filterDraft.from ? { from: model.filterDraft.from } : {}),
    ...(model.filterDraft.to ? { to: model.filterDraft.to } : {}),
  });
  const label = date === "All dates" ? "Select date range" : date;
  return h.form(
    [
      h.AriaLabel("Trip filters"),
      h.Class("filter-bar"),
      h.OnSubmit(M.ApplyFilters()),
    ],
    [
      h.div(
        [h.Class("date-filter")],
        [
          h.label(
            [h.For("date-trigger"), h.Class("field-label text-xs")],
            ["Pickup date range"],
          ),
          h.input([
            h.Type("hidden"),
            h.Name("from"),
            h.Value(model.filterDraft.from),
          ]),
          h.input([
            h.Type("hidden"),
            h.Name("to"),
            h.Value(model.filterDraft.to),
          ]),
          button(h, label, M.OpenCalendar(), [
            h.Id("date-trigger"),
            h.AriaLabel(`Pickup date range: ${label}`),
            h.Class("btn outline date-trigger"),
          ]),
        ],
      ),
      h.div(
        [h.Class("zip-filter")],
        [
          h.label(
            [h.For("pickup-zip"), h.Class("field-label text-xs")],
            ["Pickup ZIP code"],
          ),
          Input.view(
            {
              id: "pickup-zip",
              name: "zip",
              placeholder: "Enter ZIP (optional)",
              value: model.filterDraft.zip,
              onInput: (value) => M.FilterChanged({ field: "zip", value }),
              toView: (attributes) =>
                h.input([
                  ...attributes.input,
                  h.Class("input"),
                  h.InputMode("numeric"),
                  h.Pattern("[0-9]{5}"),
                  h.Maxlength(5),
                ]),
            },
            h,
          ),
        ],
      ),
      Button.view(
        {
          type: "submit",
          toView: (attributes) =>
            h.button([...attributes.button, h.Class("btn primary")], ["Apply"]),
        },
        h,
      ),
      ...(model.query
        ? [button(h, "Reset", M.ResetFilters(), [], "ghost")]
        : []),
      h.div(
        [h.Class("saved-view-bar")],
        [
          h.span([], ["Applied Explore view"]),
          button(h, "Save view", M.NewNote(), [
            h.Disabled(!filtersFromQuery(model.query)),
          ]),
          button(h, "Saved views", M.OpenSavedViews(), [], "ghost"),
          ...(model.saved?.query === model.query
            ? [h.span([h.Role("status")], [`Saved “${model.saved.title}”`])]
            : []),
        ],
      ),
    ],
  );
}
export function view(model: Model, h: H): Document {
  let content: Child[];
  if (!filtersFromQuery(model.query))
    content = [
      card(
        h,
        [
          h.h1([h.Class("text-lg font-semibold")], ["Invalid Explore filters"]),
          h.p([h.Class("muted text-sm mt-3 mb-5")], [filterError]),
          button(h, "Clear invalid filters", M.ResetFilters()),
        ],
        "p-8",
      ),
    ].map((child) => h.div([h.Role("alert")], [child]));
  else
    switch (model.path) {
      case "/":
        content = overview(h, model);
        break;
      case "/trips":
        content = trips(h, model);
        break;
      case "/map":
        content = pickupMap(h, model);
        break;
      case "/genie":
        content = [genie(h, model)];
        break;
      default:
        content = [
          h.p(
            [h.Class("text-center py-20")],
            [
              "Page not found. ",
              h.a([h.Href("/"), h.Class("underline")], ["Back to overview"]),
            ],
          ),
        ];
    }
  const current =
    navigation.find((item) => item.path === model.path)?.label ??
    (model.path === "/genie" ? "Ask Genie" : "Workspace");
  return {
    title: `NYC Taxi · ${current}`,
    body: h.div(
      [h.Class("workspace")],
      [
        ...(!model.mobile ? [sidebar(h, model)] : []),
        h.div(
          [h.Class("workspace-main")],
          [
            h.header(
              [h.Class("workspace-header")],
              [
                button(
                  h,
                  icon(h, model.mobile ? "menu" : "panel-left"),
                  M.ToggleSidebar(),
                  [
                    h.Id("navigation-trigger"),
                    h.AriaLabel(
                      model.mobile
                        ? model.mobileNavigation
                          ? "Close navigation"
                          : "Open navigation"
                        : model.sidebar
                          ? "Collapse sidebar"
                          : "Expand sidebar",
                    ),
                    h.AriaExpanded(
                      model.mobile ? model.mobileNavigation : model.sidebar,
                    ),
                    h.AriaControls("main-navigation"),
                  ],
                  "ghost",
                ),
                h.span([h.Class("h-4 border-l mx-2")], []),
                h.a(
                  [
                    h.Href(href("/", model.query)),
                    h.Class("hidden sm:block muted text-sm"),
                  ],
                  ["NYC Taxi"],
                ),
                h.span([h.Class("hidden sm:block muted text-sm")], ["/ "]),
                h.span([h.Class("text-sm")], [current]),
                ...(model.path !== "/genie"
                  ? [
                      h.div(
                        [h.Class("ml-auto")],
                        [
                          Button.view(
                            {
                              type: "button",
                              onClick: M.OpenGenie({
                                context: null,
                                question: null,
                              }),
                              isDisabled: !filtersFromQuery(model.query),
                              toView: (attributes) =>
                                h.button(
                                  [
                                    ...attributes.button,
                                    h.Id("genie-trigger"),
                                    h.Class("btn outline"),
                                  ],
                                  [
                                    icon(h, "sparkles"),
                                    h.span([], ["Ask Genie"]),
                                  ],
                                ),
                            },
                            h,
                          ),
                        ],
                      ),
                    ]
                  : []),
              ],
            ),
            h.main(
              [h.Class("workspace-content")],
              [
                ...(model.path !== "/genie" ? [filters(h, model)] : []),
                ...content,
              ],
            ),
          ],
        ),
        ...(model.genieOpen && model.path !== "/genie"
          ? [genie(h, model, true)]
          : []),
        ...(model.mobile && model.mobileNavigation
          ? [
              dialog(
                h,
                model,
                "navigation",
                "workspace-dialog sidebar-dialog",
                [sidebar(h, model)],
              ),
            ]
          : []),
        ...(model.savedViews ? [savedViews(h, model)] : []),
        ...(model.selectedTrip ? [inspector(h, model)] : []),
        ...(model.calendar ? [calendar(h, model)] : []),
        ...(model.deleting ? [deleteDialog(h, model)] : []),
        ...(model.editor ? [editor(h, model)] : []),
      ],
    ),
  };
}
