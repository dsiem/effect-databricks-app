import { Nav, Tooltip } from "@foldkit/ui";
import { Array as Arr } from "effect";
import type { Document } from "foldkit/html";
import { filterSummary } from "../domain/filter-summary";
import {
  filterError,
  filtersFromQuery,
  href,
  queryFor,
} from "../domain/filters";
import { filterFields } from "../features/filters/view";
import { genieHelperView, genieView } from "../features/genie/view";
import { pickupMapView } from "../features/map/view";
import { overviewView } from "../features/overview/view";
import {
  deleteDialogView,
  editorView,
  savedViewsView,
} from "../features/saved-views/view";
import { inspectorView } from "../features/trips/inspector";
import { tripsView } from "../features/trips/view";
import { featureView } from "../lib/feature-view";
import { dialog } from "../ui/dialog";
import { filterPanel } from "../ui/filter-panel";
import { icon } from "../ui/icons";
import { button, type Child, card } from "../ui/primitives";
import { Message as M } from "./message";
import { type Model, navigation, pageContext } from "./model";
import { themeSelector } from "./theme-view";
import { initTooltip } from "./ui-state";
import { exploreMessage } from "./view-messages";
import type { H } from "./view-types";

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
  return Nav.view({
    items: navigation.map((item) => item.path),
    ariaLabel: "Main navigation",
    toHref: (path) => href(path, model.query),
    isItemCurrent: (path) => model.path === path,
    toView: ({ nav, items }) =>
      h.nav(
        [
          ...nav,
          h.Id("main-navigation"),
          h.Class(
            `sidebar ${!model.sidebar && !model.mobile ? "collapsed" : ""}`,
          ),
        ],
        [
          h.a(
            [h.Href(href("/", model.query)), h.Class("sidebar-brand")],
            [
              h.span([h.Class("icon-tile")], [icon(h, "car-taxi-front")]),
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
                button(h, {
                  label: icon(h, "x"),
                  onClick: M.CloseNavigation(),
                  attributes: [h.AriaLabel("Close navigation")],
                  className: " absolute right-2 top-4",
                  variant: "ghost",
                }),
              ]
            : []),
          h.div(
            [h.Class("sidebar-group")],
            [
              h.p(
                [h.Class("sidebar-section-label sidebar-label")],
                ["Workspace"],
              ),
              ...Arr.zip(navigation, items).map(([item, current]) =>
                tooltip(item.path, item.label, (attrs) =>
                  h.a(
                    [
                      ...current.link,
                      h.Class(`nav-link ${current.isCurrent ? "active" : ""}`),
                      h.AriaLabel(item.label),
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
              themeSelector(h, model),
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
      ),
  });
}
function filters(h: H, model: Model) {
  const applied = filtersFromQuery(model.query);
  const hasChanges =
    !applied || queryFor(model.filtersState.filterDraft) !== queryFor(applied);
  return filterPanel(h, {
    label: "Trip filters",
    viewPicker: featureView(
      h,
      "saved-views-picker",
      savedViewsView,
      {
        ...model.savedViewsState,
        query: model.query,
        canSave: !!applied && !hasChanges,
      },
      (message) => message,
    ),
    fields: filterFields(h, {
      draft: model.filtersState.filterDraft,
      datePickers: model.filtersState.datePickers,
      onDateMessage: (field, message) => M.FilterDatePicker({ field, message }),
      onChange: (field, value) => M.FilterChanged({ field, value }),
    }),
    saveAction: button(h, {
      label: h.span(
        [h.Class("inline-flex items-center gap-2")],
        [icon(h, "plus"), "Save view"],
      ),
      onClick: M.NewSavedView(),
      disabled: !applied || hasChanges,
      attributes: [
        h.Attribute(
          "title",
          hasChanges
            ? "Apply your changes before saving a view"
            : "Save the applied filters",
        ),
      ],
    }),
    onApply: M.ApplyFilters(),
    ...(model.query || hasChanges ? { onReset: M.ResetFilters() } : {}),
    hasChanges,
    ...(applied ? { appliedSummary: filterSummary(h, applied) } : {}),
    error: model.filtersState.error,
    notice: model.savedViewsState.notice,
  });
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
          button(h, {
            label: "Clear invalid filters",
            onClick: M.ResetFilters(),
          }),
        ],
        "p-8",
      ),
    ].map((child) => h.div([h.Role("alert")], [child]));
  else
    switch (model.path) {
      case "/":
        content = [
          featureView(
            h,
            "overview",
            overviewView,
            {
              ...model.overviewState,
              query: model.query,
              mobile: model.mobile,
            },
            exploreMessage,
          ),
        ];
        break;
      case "/trips":
        content = [
          featureView(
            h,
            "trips",
            tripsView,
            {
              ...model.tripsState,
            },
            exploreMessage,
          ),
        ];
        break;
      case "/map":
        content = [
          featureView(
            h,
            "pickupMap",
            pickupMapView,
            {
              ...model.mapState,
              overview: model.overviewState.overview,
              query: model.query,
            },
            exploreMessage,
          ),
        ];
        break;
      case "/genie":
        content = [
          featureView(
            h,
            "genie",
            genieView,
            {
              ...model.genieState,
              context: pageContext(model),
              mobile: model.mobile,
              query: model.query,
              status: model.status,
            },
            (message) => message,
          ),
        ];
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
                button(h, {
                  label: icon(h, model.mobile ? "menu" : "panel-left"),
                  onClick: M.ToggleSidebar(),
                  attributes: [
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
                  variant: "ghost",
                }),
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
                h.div(
                  [h.Class("ml-auto flex items-center gap-2")],
                  [
                    ...(model.path !== "/genie"
                      ? [
                          button(h, {
                            label: h.span(
                              [h.Class("inline-flex items-center gap-2")],
                              [icon(h, "sparkles"), "Ask Genie"],
                            ),
                            onClick: M.OpenGenie({
                              context: null,
                              question: null,
                            }),
                            disabled: !filtersFromQuery(model.query),
                            attributes: [h.Id("genie-trigger")],
                          }),
                        ]
                      : []),
                  ],
                ),
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
        ...(model.genieState.genieOpen && model.path !== "/genie"
          ? [
              featureView(
                h,
                "genie-helper",
                genieHelperView,
                {
                  ...model.genieState,
                  context: pageContext(model),
                  mobile: model.mobile,
                  query: model.query,
                  status: model.status,
                },
                (message) => message,
              ),
            ]
          : []),
        ...(model.mobile && model.mobileNavigation
          ? [
              dialog(h, {
                model: model.navigationDialog,
                onMessage: (message) => M.NavigationDialog({ message }),
                className: "dialog-panel sheet sidebar-dialog",
                accessibleTitle: "Sidebar",
                children: [sidebar(h, model)],
              }),
            ]
          : []),
        ...(model.tripsState.selectedTrip
          ? [
              featureView(
                h,
                "inspector",
                inspectorView,
                {
                  ...model.tripsState,
                },
                (message) => message,
              ),
            ]
          : []),
        ...(model.savedViewsState.deleting
          ? [
              featureView(
                h,
                "deleteDialog",
                deleteDialogView,
                {
                  ...model.savedViewsState,
                },
                (message) => message,
              ),
            ]
          : []),
        ...(model.savedViewsState.editor
          ? [
              featureView(
                h,
                "editor",
                editorView,
                {
                  ...model.savedViewsState,
                },
                (message) => message,
              ),
            ]
          : []),
      ],
    ),
  };
}
