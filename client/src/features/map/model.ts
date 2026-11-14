import { Schema } from "effect";
export const Model = Schema.Struct({
  mappedTrips: Schema.NullOr(Schema.Number),
  mapError: Schema.String,
});

export type Model = typeof Model.Type;

export const init = (): Model => ({ mappedTrips: null, mapError: "" });
