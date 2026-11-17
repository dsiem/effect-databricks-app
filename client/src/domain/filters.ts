import { Schema } from "effect";
import * as D from "../../../shared/domain";
export const filtersFromQuery = (query: string) => {
  const parsed = Schema.decodeUnknownOption(D.Filters)(
    Object.fromEntries(new URLSearchParams(query)),
  );
  return parsed._tag === "Some" ? parsed.value : null;
};
export const filterError =
  "Check the dates and five-digit ZIP code. The start date must be on or before the end date.";
export const queryFor = (filters: D.Filters) =>
  new URLSearchParams(
    (["from", "to", "zip"] as const).flatMap((key) => {
      const value = filters[key];
      return value ? [[key, value]] : [];
    }),
  ).toString();
export const href = (path: string, query: string) =>
  path + (query ? `?${query}` : "");

export const tripSortFromQuery = (query: string): typeof D.TripSort.Type => {
  const parsed = Schema.decodeUnknownOption(D.TripSort)(
    new URLSearchParams(query).get("sort"),
  );
  return parsed._tag === "Some" ? parsed.value : "newest";
};
export const withTripSort = (query: string, sort: typeof D.TripSort.Type) => {
  const params = new URLSearchParams(query);
  params.delete("sort");
  if (sort !== "newest") params.set("sort", sort);
  return params.toString();
};
