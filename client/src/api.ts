import { useQuery } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useSearchParams } from "react-router-dom";
import { Filters, Metadata, Overview, Status } from "../../src/domain";

const ErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
export function api<A>(
  path: string,
  schema: Schema.Decoder<A>,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async (cancel) => {
        const response = await fetch(path, {
          ...options,
          headers: { "Content-Type": "application/json", ...options.headers },
          signal: cancel,
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = Schema.decodeUnknownOption(ErrorBody)(body);
          throw new Error(
            error._tag === "Some"
              ? error.value.error.message
              : `Request failed (${response.status})`,
          );
        }
        return body;
      },
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Unable to connect to the app."),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((error) =>
        error instanceof Error
          ? error
          : new Error("Unexpected server response."),
      ),
    ),
    { ...(signal ? { signal } : {}) },
  );
}
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const parsed = Schema.decodeUnknownOption(Filters)(
    Object.fromEntries(params),
  );
  const filters: Filters = parsed._tag === "Some" ? parsed.value : {};
  const query = new URLSearchParams(Object.entries(filters)).toString();
  return {
    filters,
    query,
    setFilters: (next: Filters) =>
      setParams(
        Object.fromEntries(Object.entries(next).filter(([, value]) => value)),
      ),
  };
}
export function useOverview() {
  const { query } = useFilters();
  return useQuery({
    queryKey: ["overview", query],
    queryFn: ({ signal }) =>
      api(`/api/overview?${query}`, Overview, {}, signal),
    staleTime: 60_000,
    retry: 1,
  });
}
export const useMetadata = () =>
  useQuery({
    queryKey: ["metadata"],
    queryFn: ({ signal }) => api("/api/metadata", Metadata, {}, signal),
    staleTime: 300_000,
    retry: 1,
  });
export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api("/api/status", Status, {}, signal),
    staleTime: 60_000,
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
