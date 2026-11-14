import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useSearchParams } from "react-router-dom";
import { Filters } from "../../src/domain";
import { api, apiClient } from "./lib/api-client";

export { ApiRequestError, api, apiClient } from "./lib/api-client";

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const parsed = Schema.decodeUnknownOption(Filters)(
    Object.fromEntries(params),
  );
  const filters: Filters = parsed._tag === "Some" ? parsed.value : {};
  // Keep invalid URLs visible across navigation until the user corrects them.
  const query =
    parsed._tag === "Some"
      ? new URLSearchParams(Object.entries(filters)).toString()
      : params.toString();
  return {
    filters,
    query,
    filterError:
      parsed._tag === "Some"
        ? null
        : "Check the dates and five-digit ZIP code. The start date must be on or before the end date.",
    setFilters: (next: Filters) =>
      setParams(
        Object.fromEntries(Object.entries(next).filter(([, value]) => value)),
      ),
  };
}
export function useOverview() {
  const { filters, query } = useFilters();
  return useQuery({
    queryKey: ["overview", query],
    queryFn: ({ signal }) =>
      api(apiClient.overview({ query: filters }), signal),
    staleTime: 60_000,
    retry: 1,
  });
}
export const useMetadata = () =>
  useQuery({
    queryKey: ["metadata"],
    queryFn: ({ signal }) => api(apiClient.metadata(), signal),
    staleTime: 300_000,
    retry: 1,
  });
export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api(apiClient.status(), signal),
    staleTime: 60_000,
  });
export const useCurrentUser = () =>
  useQuery({
    queryKey: ["current-user"],
    queryFn: ({ signal }) => api(apiClient.currentUser(), signal),
    staleTime: 300_000,
    retry: false,
  });
export const number = (value: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(value));
export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
