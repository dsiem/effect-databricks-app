import { format, parseISO } from "date-fns";
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
export const dateLabel = (filters: {
  readonly from?: string;
  readonly to?: string;
}) => {
  const from = filters.from
    ? format(parseISO(filters.from), "MMM d, yyyy")
    : "";
  const to = filters.to ? format(parseISO(filters.to), "MMM d, yyyy") : "";
  return from
    ? to
      ? `${from} – ${to}`
      : `From ${from}`
    : to
      ? `Through ${to}`
      : "All dates";
};
