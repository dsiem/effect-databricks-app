import { Effect } from "effect";
import type { CapabilityAvailability } from "./domain.js";
import type { ServiceError } from "./errors.js";

// Availability records the last dependency outcome; it is not a health probe.
export const makeCapability = (configured: boolean) => {
  let availability: CapabilityAvailability = configured
    ? "unknown"
    : "unconfigured";
  const set = (value: CapabilityAvailability) =>
    Effect.sync(() => {
      if (configured) availability = value;
    });
  return {
    availability: Effect.sync(() => availability),
    track: <A, E extends ServiceError, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.tap(() => set("available")),
        Effect.tapError((error) => {
          switch (error._tag) {
            case "InvalidRequest":
              return Effect.void;
            case "NoteNotFound":
            case "GenieFailed":
              return set("available");
            default:
              return set("unavailable");
          }
        }),
      ),
  };
};
