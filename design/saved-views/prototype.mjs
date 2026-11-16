import { makeViews, searchViews, summary } from "./fixtures.mjs";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const icons = {
  book: '<path d="M12 7C8 4 4 5 3 6v13c3-2 6-1 9 1 3-2 6-3 9-1V6c-3-2-6-1-9 1Z"/><path d="M12 7v13"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  pin: '<path d="m9 3 6 0-1 6 4 4H6l4-4-1-6ZM12 13v8"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icons[name]}</svg>`;
const definitions = [
  {
    id: "quick",
    letter: "A",
    title: "Quick picker",
    tag: "Recommended starting point",
    description:
      "Stay in the explorer. Search when you know it; pins and recents when you don’t.",
    verdict:
      "Least ceremony for everyday switching. Details stay visible without opening another screen.",
  },
  {
    id: "command",
    letter: "B",
    title: "Command switcher",
    tag: "For frequent switching",
    description:
      "Type a fragment, move with the arrow keys, then press Enter to apply.",
    verdict:
      "Strong keyboard flow. A preview helps with similar names, but adds a new interaction to learn.",
  },
  {
    id: "library",
    letter: "C",
    title: "View library",
    tag: "For browsing and discovery",
    description:
      "Narrow by pin or pickup ZIP. Inspect the finding, then apply the right view.",
    verdict:
      "More room to investigate an unfamiliar collection. An extra decision for a simple switch.",
  },
];
let rows = makeViews(1000);
const states = new Map();
const comparison = document.querySelector("#comparison");

function mount() {
  states.clear();
  comparison.innerHTML = definitions
    .map(
      (
        def,
      ) => `<article id="${def.id}" class="direction" aria-label="${def.title}">
    <header class="direction-heading"><span class="direction-letter">${def.letter}</span><span class="direction-tag ${def.id === "quick" ? "recommended" : ""}">${def.tag}</span><h2>${def.title}</h2><p>${def.description}</p></header>
    <div class="workspace"><div class="workspace-top"><span class="eyebrow">EXPLORE / TRIPS</span><span class="workspace-dots">•••</span></div>
      <button class="trigger" type="button" aria-expanded="true" aria-controls="${def.id}-panel">${icon("book")}<span>All trips</span>${icon("chevron")}</button>
      <section id="${def.id}-panel" class="picker ${def.id}" aria-label="${def.title} options">
        <div class="panel-heading"><strong>${def.id === "library" ? "Browse saved views" : "Switch view"}</strong><button class="close icon-button" type="button" aria-label="Close ${def.title}">${icon("x")}</button></div>
        <div class="search-wrap">${icon("search")}<input id="${def.id}-search" type="search" placeholder="${def.id === "command" ? "Jump to a view…" : "Search name, finding, or ZIP…"}" aria-label="Search all saved views" autocomplete="off" ${def.id === "command" ? `role="combobox" aria-autocomplete="list" aria-controls="command-results" aria-expanded="true"` : ""}/></div>
        ${def.id === "library" ? `<div class="library-tools"><div class="scopes" role="group" aria-label="View scope"><button type="button" aria-pressed="true" data-scope="all">All views</button><button type="button" aria-pressed="false" data-scope="pinned">Pinned</button></div><div class="select-tools"><label>Pickup ZIP<select class="zip"><option value="">Any ZIP</option>${[...new Set(rows.map((row) => row.filters.zip))].map((zip) => `<option>${zip}</option>`).join("")}</select></label><label>Sort<select class="order"><option value="recent">Recently updated</option><option value="name">Name A–Z</option></select></label></div></div>` : ""}
        <div class="results-meta" role="status" aria-live="polite"></div>
        <div class="results" id="${def.id}-results" ${def.id === "command" ? 'role="listbox" aria-label="Matching saved views"' : 'role="group" aria-label="Matching saved views"'}></div>
        ${def.id !== "quick" ? '<div class="preview"></div>' : ""}
        <footer class="panel-footer">${def.id === "command" ? "<span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> apply · <kbd>esc</kbd> close</span>" : def.id === "library" ? "<span>Inspect a view before applying</span>" : '<span>Pinned + recently used</span><button type="button" class="browse">Browse all views</button>'}</footer>
      </section>
      <div class="applied" role="status" aria-live="polite"><span class="applied-label">APPLIED VIEW</span><strong>All trips</strong><span>No filters applied</span></div>
    </div><p class="direction-verdict">${def.verdict}</p>
  </article>`,
    )
    .join("");

  for (const def of definitions) {
    const root = document.getElementById(def.id);
    const state = {
      def,
      root,
      query: "",
      scope: "all",
      zip: "",
      order: "recent",
      limit: 24,
      active: 0,
      browse: false,
      applied: null,
      recent: [rows[5].id, rows[6].id, rows[7].id],
      matches: [],
    };
    states.set(def.id, state);
    root
      .querySelector(".trigger")
      .addEventListener("click", () =>
        setOpen(state, root.querySelector(".picker").hidden),
      );
    root
      .querySelector(".close")
      .addEventListener("click", () => setOpen(state, false));
    root.querySelector("input").addEventListener("input", (event) => {
      state.query = event.target.value;
      state.active = 0;
      state.limit = 24;
      render(state);
    });
    root.querySelector(".picker").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(state, false);
      }
      if (def.id !== "command" || event.target !== root.querySelector("input"))
        return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        state.active = Math.min(
          Math.max(0, state.active + (event.key === "ArrowDown" ? 1 : -1)),
          Math.min(state.matches.length, state.limit) - 1,
        );
        render(state);
        root
          .querySelector('[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && state.matches[state.active]) {
        event.preventDefault();
        apply(state, state.matches[state.active]);
      }
    });
    root.querySelector(".browse")?.addEventListener("click", () => {
      state.browse = true;
      render(state);
      root.querySelector("input").focus();
    });
    root.querySelectorAll("[data-scope]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scope = button.dataset.scope;
        state.active = 0;
        state.limit = 24;
        root.querySelectorAll("[data-scope]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        render(state);
      });
    });
    for (const field of ["zip", "order"])
      root.querySelector(`.${field}`)?.addEventListener("change", (event) => {
        state[field] = event.target.value;
        state.active = 0;
        state.limit = 24;
        render(state);
      });
    render(state);
  }
  applyLayout();
}

function setOpen(state, open) {
  state.root.querySelector(".picker").hidden = !open;
  state.root
    .querySelector(".trigger")
    .setAttribute("aria-expanded", String(open));
  if (state.def.id === "command")
    state.root
      .querySelector("input")
      .setAttribute("aria-expanded", String(open));
  (open
    ? state.root.querySelector("input")
    : state.root.querySelector(".trigger")
  ).focus();
}

function apply(state, row) {
  state.applied = row;
  state.recent = [row.id, ...state.recent.filter((id) => id !== row.id)].slice(
    0,
    3,
  );
  state.root.querySelector(".trigger span").textContent = row.title;
  state.root.querySelector(".applied").innerHTML =
    `<span class="applied-label">APPLIED VIEW</span><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(summary(row))}</span>`;
  state.root.querySelector(".applied").dataset.viewId = row.id;
  state.query = "";
  state.root.querySelector("input").value = "";
  state.browse = false;
  state.active = 0;
  state.limit = 24;
  render(state);
  setOpen(state, false);
}

function render(state) {
  const { root, def } = state;
  const quickStart =
    !state.query.trim() && !state.browse && def.id !== "library";
  state.matches = quickStart
    ? [
        ...rows.filter((row) => row.pinned),
        ...state.recent
          .map((id) => rows.find((row) => row.id === id))
          .filter((row) => row && !row.pinned),
      ]
    : searchViews(rows, state.query, state.scope, state.zip, state.order);
  const visible = state.matches.slice(0, state.limit);
  root.querySelector(".results-meta").textContent = quickStart
    ? `Pinned & recent · search all ${rows.length.toLocaleString()} views`
    : `${state.matches.length.toLocaleString()} matching views · ${Math.min(state.limit, state.matches.length)} shown`;
  if (def.id === "quick")
    root.querySelector(".panel-footer > span").textContent = quickStart
      ? "Pinned + recently used"
      : "Search across all saved views";
  const list = root.querySelector(".results");
  list.innerHTML = visible.length
    ? visible
        .map(
          (
            row,
            index,
          ) => `<button type="button" id="${def.id}-option-${index}" class="view-row ${def.id !== "quick" && state.active === index ? "active" : ""}" data-id="${row.id}" ${def.id === "command" ? `role="option" aria-selected="${index === state.active}" tabindex="-1"` : ""}>
    <span class="row-title">${escapeHtml(row.title)}${row.pinned ? icon("pin") : ""}${state.applied?.id === row.id ? '<span class="applied-badge">Applied</span>' : ""}</span>
    <span class="row-summary">${escapeHtml(summary(row))}</span>
    ${def.id === "quick" ? `<span class="row-body">${escapeHtml(row.body)}</span>` : ""}
  </button>`,
        )
        .join("")
    : `<div class="empty"><strong>No matching views</strong><p>Try a shorter name, a finding, or a pickup ZIP.${state.scope !== "all" || state.zip ? " Or clear the library filters." : ""}</p><button type="button" class="reset">Clear search and filters</button></div>`;
  list.querySelectorAll(".view-row").forEach((button, index) => {
    button.addEventListener("click", () => {
      if (def.id === "library") {
        state.active = index;
        render(state);
        root.querySelector(`#library-option-${index}`)?.focus();
      } else apply(state, state.matches[index]);
    });
  });
  list.querySelector(".reset")?.addEventListener("click", () => {
    state.query = "";
    state.scope = "all";
    state.zip = "";
    state.active = 0;
    root.querySelector("input").value = "";
    root.querySelectorAll("[data-scope]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item.dataset.scope === "all"));
    });
    if (root.querySelector(".zip")) root.querySelector(".zip").value = "";
    render(state);
    root.querySelector("input").focus();
  });
  if (state.matches.length > state.limit) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.textContent = "Show more matches";
    more.addEventListener("click", () => {
      state.limit += 24;
      render(state);
      root.querySelector(`#${def.id}-option-${state.limit - 24}`)?.focus();
    });
    list.append(more);
  }
  if (def.id === "command") {
    const input = root.querySelector("input");
    if (visible.length)
      input.setAttribute(
        "aria-activedescendant",
        `command-option-${state.active}`,
      );
    else input.removeAttribute("aria-activedescendant");
  }
  const preview = root.querySelector(".preview");
  if (preview) {
    const row = state.matches[state.active];
    preview.innerHTML = row
      ? `<span class="preview-label">${def.id === "library" ? "VIEW DETAILS" : "PREVIEW"}</span><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.body)}</p><span class="row-summary">${escapeHtml(summary(row))}</span>${def.id === "library" ? `<button type="button" class="apply">Apply this view ${icon("arrow")}</button>` : ""}`
      : '<p class="muted">Select a matching view to see its details.</p>';
    preview
      .querySelector(".apply")
      ?.addEventListener("click", () => apply(state, row));
  }
}

function applyLayout() {
  const layout = document.querySelector("#layout").value;
  comparison.classList.toggle("focused", layout !== "all");
  for (const state of states.values())
    state.root.hidden = layout !== "all" && state.def.id !== layout;
}
document.querySelector("#volume").addEventListener("change", (event) => {
  rows = makeViews(Number(event.target.value));
  mount();
});
document.querySelector("#layout").addEventListener("change", applyLayout);
document.querySelector("#task-context").addEventListener("click", () => {
  document.querySelector("#context-hint").hidden =
    !document.querySelector("#context-hint").hidden;
});
mount();
