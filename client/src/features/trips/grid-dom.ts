import type { TripSummary } from "../../../../shared/domain";
import { tripQueryKey } from "../../../../shared/trip-dataset";
import { money } from "../../lib/format";
import { downloadCsv, summaryCsv } from "./export";
import type { GridEvent } from "./grid-mount";
import type { GridInput, WorkerRequest, WorkerResponse } from "./grid-protocol";
import { Message as M } from "./messages";

type Window = Extract<WorkerResponse, { type: "window" }>;
export function createGridDom(
  element: HTMLElement,
  {
    send,
    publish,
  }: {
    readonly send: (request: WorkerRequest) => void;
    readonly publish: (event: GridEvent) => void;
  },
) {
  let input: GridInput | undefined;
  let data: Window | undefined;
  let frame = 0;
  let rowHeight = 56;
  let enabled = false;
  let selectedId: string | null = null;
  let counts: Readonly<Record<string, number>> = {};
  let countError = "";
  let sampleIdentity = "";
  const nodes = new Map<string, HTMLTableRowElement>();
  const scroller = document.createElement("div");
  scroller.className = "trip-grid-scroll";
  scroller.tabIndex = 0;
  scroller.setAttribute("role", "region");
  scroller.setAttribute(
    "aria-label",
    "Matching trips. Use arrow keys to browse and Enter to inspect.",
  );
  const table = document.createElement("table");
  table.className = "trip-grid-table";
  const caption = table.createCaption();
  caption.className = "sr-only";
  caption.textContent = "Matching trips";
  const head = table.createTHead().insertRow();
  for (const [index, label] of [
    "Pickup time",
    "Route · ZIP",
    "Drop-off time",
    "Distance",
    "Duration",
    "Fare",
    "Inspect",
  ].entries()) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    if (index === 2 || index === 4) th.className = "trip-grid-secondary";
    head.append(th);
  }
  const body = table.createTBody();
  scroller.append(table);
  const controls = document.createElement("div");
  controls.className = "trip-grid-controls";
  const earlier = document.createElement("button");
  earlier.type = "button";
  earlier.textContent = "Load earlier trips";
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = "Load later trips";
  const label = document.createElement("span");
  label.setAttribute("aria-live", "polite");
  const exportAll = document.createElement("button");
  exportAll.type = "button";
  exportAll.textContent = "Export complete matching result";
  const exportVisible = document.createElement("button");
  exportVisible.type = "button";
  exportVisible.textContent = "Export visible subset";
  controls.append(earlier, label, later, exportAll, exportVisible);
  element.replaceChildren(scroller, controls);
  const range = () => {
    frame = 0;
    if (!input || !data || !enabled) return;
    const start =
      data.base +
      Math.max(
        0,
        Math.floor((scroller.scrollTop - head.offsetHeight) / rowHeight) - 5,
      );
    send({
      type: "range",
      key: input.key,
      start,
      count: Math.min(80, Math.ceil(scroller.clientHeight / rowHeight) + 12),
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(range);
  };
  const inspect = (id: string) => {
    if (enabled && input) send({ type: "inspect", key: input.key, tripId: id });
  };
  const row = (trip: TripSummary, index: number) => {
    let tr = nodes.get(trip.trip_id);
    if (!tr) {
      tr = document.createElement("tr");
      tr.dataset.tripId = trip.trip_id;
      const values = [
        trip.pickup_at,
        `${trip.pickup_zip ?? "Unknown"} →${trip.dropoff_zip ?? "Unknown"}`,
        trip.dropoff_at,
        `${trip.distance.toFixed(2)} mi`,
        `${trip.duration.toFixed(1)} min`,
        money(trip.fare, 2),
      ];
      for (const [i, value] of values.entries()) {
        const td = tr.insertCell();
        td.textContent = i === 0 || i === 2 ? value.slice(0, 19) : value;
        td.title = value;
        if (i === 2 || i === 4) td.className = "trip-grid-secondary";
      }
      const button = document.createElement("button");
      button.type = "button";
      const actionLabel = document.createElement("span");
      actionLabel.textContent = "Inspect";
      const countLabel = document.createElement("span");
      countLabel.className = "trip-grid-comment-count";
      button.append(actionLabel, countLabel);
      button.setAttribute(
        "aria-label",
        `Inspect trip ${trip.pickup_at} from ${trip.pickup_zip ?? "Unknown"} to ${trip.dropoff_zip ?? "Unknown"}`,
      );
      button.onclick = () => inspect(trip.trip_id);
      tr.insertCell().append(button);
      nodes.set(trip.trip_id, tr);
    }
    tr.setAttribute("aria-rowindex", String(index + 2));
    tr.setAttribute("aria-selected", String(trip.trip_id === selectedId));
    tr.style.height = `${rowHeight}px`;
    const button = tr.querySelector("button");
    if (button) {
      button.disabled = !enabled;
      const count = counts[trip.trip_id];
      const countLabel = button.querySelector(".trip-grid-comment-count");
      const description =
        count === undefined
          ? countError
            ? "comments unavailable"
            : "loading comments"
          : `${count} ${count === 1 ? "comment" : "comments"}`;
      if (countLabel)
        countLabel.textContent = ` · ${count === undefined ? "–" : count}`;
      button.title = description;
      button.setAttribute(
        "aria-label",
        `Inspect trip ${trip.pickup_at} from ${trip.pickup_zip ?? "Unknown"} to ${trip.dropoff_zip ?? "Unknown"}, ${description}`,
      );
    }
    return tr;
  };
  const spacer = (height: number) => {
    const tr = document.createElement("tr");
    tr.setAttribute("aria-hidden", "true");
    const td = tr.insertCell();
    td.colSpan = 7;
    td.style.height = `${Math.max(0, height)}px`;
    td.style.padding = "0";
    td.style.border = "0";
    return tr;
  };
  const render = (next: Window) => {
    const oldBase = data?.base ?? next.base;
    const previousQuery = data?.key !== next.key;
    const focused =
      document.activeElement instanceof HTMLButtonElement &&
      body.contains(document.activeElement)
        ? document.activeElement
        : null;
    const focusedRow = focused?.closest("tr");
    // A focused row remains mounted just outside the viewport. Only one is pinned.
    const pinnedIndex = Number(focusedRow?.getAttribute("aria-rowindex")) - 2;
    const pinnedId = focusedRow?.dataset.tripId;
    const pin =
      focusedRow &&
      pinnedId &&
      !previousQuery &&
      pinnedIndex >= next.base &&
      pinnedIndex < next.base + next.available &&
      !next.rows.some((trip) => trip.trip_id === pinnedId)
        ? { row: focusedRow, index: pinnedIndex }
        : null;
    const entries = next.rows.map((trip, i) => ({
      row: row(trip, next.start + i),
      index: next.start + i,
    }));
    if (pin) entries.push(pin);
    entries.sort((a, b) => a.index - b.index);
    const children: HTMLTableRowElement[] = [];
    let position = next.base;
    for (const entry of entries) {
      children.push(spacer((entry.index - position) * rowHeight), entry.row);
      position = entry.index + 1;
    }
    children.push(spacer((next.base + next.available - position) * rowHeight));
    body.replaceChildren(...children);
    const retained = new Set(next.rows.map((trip) => trip.trip_id));
    if (pin && pinnedId) retained.add(pinnedId);
    for (const id of nodes.keys()) if (!retained.has(id)) nodes.delete(id);
    data = next;
    const identity = JSON.stringify([
      next.key,
      next.snapshot,
      next.start,
      next.rows.map((row) => row.trip_id),
    ]);
    if (identity !== sampleIdentity) {
      sampleIdentity = identity;
      publish(
        M.TripGridWindow({
          key: next.key,
          snapshot: next.snapshot,
          start: next.start,
          visible: next.rows.length,
          sample: next.rows.slice(0, 5),
        }),
      );
    }
    exportVisible.disabled = !enabled || !next.rows.length;
    table.setAttribute("aria-rowcount", String(next.total + 1));
    if (previousQuery) scroller.scrollTop = 0;
    else if (oldBase !== next.base)
      scroller.scrollTop += (oldBase - next.base) * rowHeight;
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    else if (focused) scroller.focus({ preventScroll: true });
    label.textContent = next.total
      ? `${next.base + 1}–${next.base + next.available} loaded · ${next.total.toLocaleString()} matching trips`
      : "No trips match these filters.";
    earlier.hidden = !next.previous;
    later.hidden = !next.next;
    earlier.disabled = !enabled;
    later.disabled = !enabled;
  };
  const receive = (message: WorkerResponse) => {
    if (message.key !== input?.key) return;
    if (message.type === "export") {
      downloadCsv(message.csv, message.filename);
    } else if (message.type === "counts") {
      counts = message.counts;
      countError = message.error;
      if (data) render(data);
    } else if (message.type === "window") {
      const refreshRange =
        !data ||
        data.key !== message.key ||
        data.base !== message.base ||
        data.available !== message.available;
      if (data?.key !== message.key || data.snapshot !== message.snapshot)
        nodes.clear();
      enabled = true;
      render(message);
      if (refreshRange) schedule();
      focusPending();
    } else if (message.type === "status") {
      exportAll.hidden = message.scope !== "complete";
      exportAll.disabled =
        message.loading || message.scope !== "complete" || !!message.error;
      // Loading more keeps current rows usable. A replacement query disables old rows.
      scroller.setAttribute("aria-busy", String(message.loading));
      publish(M.TripGridStatus(message));
    } else
      publish(M.TripGridSelected({ key: message.key, trip: message.trip }));
  };
  const fail = () => {
    if (!input) return;
    enabled = false;
    scroller.setAttribute("aria-busy", "false");
    exportAll.disabled = true;
    exportVisible.disabled = true;
    earlier.disabled = true;
    later.disabled = true;
    for (const button of body.querySelectorAll("button"))
      button.disabled = true;
    publish(
      M.TripGridStatus({
        key: input.key,
        loading: false,
        error: "The trip worker stopped. Reload the query to retry.",
        scope: "none",
        total: 0,
        loaded: 0,
      }),
    );
  };
  const onKey = (event: KeyboardEvent) => {
    if (!data || !enabled) return;
    const tr = document.activeElement?.closest("tr");
    const current = tr
      ? Number(tr.getAttribute("aria-rowindex")) - 2
      : data.start;
    const delta =
      event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowUp"
          ? -1
          : event.key === "PageDown"
            ? 8
            : event.key === "PageUp"
              ? -8
              : 0;
    if (!delta) return;
    event.preventDefault();
    const target = Math.max(
      data.base,
      Math.min(data.base + data.available - 1, current + delta),
    );
    scroller.scrollTop = Math.max(
      0,
      (target - data.base) * rowHeight - scroller.clientHeight / 2,
    );
    const button = body.querySelector<HTMLButtonElement>(
      `tr[aria-rowindex="${target + 2}"] button`,
    );
    if (button) button.focus({ preventScroll: true });
    else {
      scroller.focus({ preventScroll: true });
      pendingFocus = target;
    }
    schedule();
  };
  let pendingFocus: number | undefined;
  // Focus a keyboard target only after its requested window has arrived.
  const focusPending = () => {
    if (pendingFocus === undefined) return;
    const button = body.querySelector<HTMLButtonElement>(
      `tr[aria-rowindex="${pendingFocus + 2}"] button`,
    );
    if (button && document.activeElement === scroller) {
      button.focus({ preventScroll: true });
      pendingFocus = undefined;
    }
  };
  scroller.addEventListener("scroll", schedule, { passive: true });
  scroller.addEventListener("keydown", onKey);
  exportAll.onclick = () => {
    if (input && enabled) send({ type: "export", key: input.key });
  };
  exportVisible.onclick = () => {
    if (input && enabled && data?.key === input.key)
      downloadCsv(
        summaryCsv(data.rows),
        "taxi-trip-summaries-visible-subset.csv",
      );
  };
  earlier.onclick = () => {
    if (input) send({ type: "step", key: input.key, direction: "previous" });
  };
  later.onclick = () => {
    if (input) send({ type: "step", key: input.key, direction: "next" });
  };
  const observer = new ResizeObserver(() => {
    rowHeight = Math.max(
      56,
      Math.ceil(Number.parseFloat(getComputedStyle(element).fontSize) * 3.5),
    );
    if (data) render(data);
    schedule();
  });
  observer.observe(scroller);
  return {
    receive,
    fail,
    update: (next: GridInput) => {
      selectedId = next.selectedId;
      const invalidateCounts = input?.countsVersion !== next.countsVersion;
      if (input?.key === next.key) {
        input = next;
        if (invalidateCounts)
          send({ type: "invalidate-counts", key: next.key });
        if (data) render(data);
        return;
      }
      const force =
        input !== undefined &&
        tripQueryKey(input.query) === tripQueryKey(next.query);
      input = next;
      enabled = false;
      counts = {};
      countError = "";
      earlier.disabled = true;
      later.disabled = true;
      exportAll.disabled = true;
      exportVisible.disabled = true;
      pendingFocus = undefined;
      nodes.clear();
      for (const button of body.querySelectorAll("button"))
        button.disabled = true;
      send({ type: "query", key: next.key, query: next.query, force });
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("keydown", onKey);
      exportAll.onclick = null;
      exportVisible.onclick = null;
      earlier.onclick = null;
      later.onclick = null;
      nodes.clear();
      element.replaceChildren();
    },
  };
}
