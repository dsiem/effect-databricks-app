import { Schema } from "effect";
export const fields = {
  mappedTrips: Schema.NullOr(Schema.Number),
  mapError: Schema.String,
};
