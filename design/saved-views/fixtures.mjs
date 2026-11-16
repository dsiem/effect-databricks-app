// Shared by the interactive study and its browser check. No live records.
export const targetTitle = "JFK late-night · winter exceptions";
export const makeViews = (count) => {
  const areas = [
    ["Midtown", "10001"],
    ["Chelsea", "10011"],
    ["SoHo", "10012"],
    ["Upper East Side", "10021"],
    ["JFK", "11430"],
    ["LaGuardia", "11371"],
    ["Harlem", "10027"],
    ["Financial District", "10005"],
  ];
  const topics = [
    "fare review",
    "weekend pickups",
    "long journeys",
    "morning demand",
    "airport connections",
    "late-night arrivals",
    "short journeys",
  ];
  const rows = Array.from({ length: count }, (_, index) => {
    const [area, zip] = areas[index % areas.length];
    const topic = topics[Math.floor(index / areas.length) % topics.length];
    const cycle = Math.floor(index / (areas.length * topics.length)) + 1;
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title: `${area} ${topic}${cycle > 1 ? ` · review ${cycle}` : ""}`,
      body: `Review ${topic} around ${area}. Compare demand and fares during January 2016.`,
      filters: { zip, from: "2016-01-01", to: "2016-01-31" },
      pinned: index < 3,
      version: 1,
      created_at: new Date(
        Date.UTC(2026, 0, 1, 0, 0, count - index),
      ).toISOString(),
      updated_at: new Date(
        Date.UTC(2026, 0, 1, 0, 0, count - index),
      ).toISOString(),
    };
  });
  // Same name, different filters: selection must expose enough context.
  for (const [index, from, to, period] of [
    [3, "2016-01-01", "2016-01-07", "January 1–7"],
    [4, "2016-01-08", "2016-01-14", "January 8–14"],
  ]) {
    rows[index] = {
      ...rows[index],
      title: "Midtown fare review",
      filters: { zip: "10001", from, to },
      body: `${period}, 2016. Compare high fares near Penn Station.`,
    };
  }
  rows[count - 1] = {
    ...rows[count - 1],
    title: targetTitle,
    body: "Follow up flight delays and unusually long airport journeys after midnight.",
    filters: { zip: "11430", from: "2016-02-01", to: "2016-02-29" },
  };
  return rows;
};

export const summary = (row) =>
  `Pickup ${row.filters.zip} · ${row.filters.from} → ${row.filters.to}`;

// Token matching allows fragments in any order across name, finding and filters.
export function searchViews(
  rows,
  query,
  scope = "all",
  zip = "",
  order = "recent",
) {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows
    .filter(
      (row) =>
        (scope !== "pinned" || row.pinned) &&
        (!zip || row.filters.zip === zip) &&
        tokens.every((token) =>
          `${row.title} ${row.body} ${summary(row)}`
            .toLocaleLowerCase()
            .includes(token),
        ),
    )
    .sort((a, b) => {
      if (order === "name")
        return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (query.trim()) {
        const rank = (row) =>
          row.title
            .toLocaleLowerCase()
            .startsWith(query.trim().toLocaleLowerCase())
            ? 0
            : 1;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
      }
      return (
        Number(b.pinned) - Number(a.pinned) ||
        b.updated_at.localeCompare(a.updated_at) ||
        b.id.localeCompare(a.id)
      );
    });
}
