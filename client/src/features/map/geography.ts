import { Schema } from "effect";
import { Zip, type Zone } from "../../../../shared/domain";

const Position = Schema.mutable(Schema.Array(Schema.Number));
const PolygonCoordinates = Schema.mutable(
  Schema.Array(Schema.mutable(Schema.Array(Position))),
);
const Geometry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Polygon"),
    coordinates: PolygonCoordinates,
  }),
  Schema.Struct({
    type: Schema.Literal("MultiPolygon"),
    coordinates: Schema.mutable(Schema.Array(PolygonCoordinates)),
  }),
]);
const GeographySource = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literal("Feature"),
        properties: Schema.Struct({
          label: Schema.String,
          zcta: Schema.String,
          modzcta: Schema.String,
        }),
        geometry: Geometry,
      }),
    ),
  ),
});
const PostalZips = Schema.NonEmptyArray(Zip);

export function parseGeography(value: unknown) {
  const geography = Schema.decodeUnknownSync(GeographySource)(value);
  return {
    ...geography,
    features: geography.features.map(
      ({ properties: { zcta, ...properties }, ...feature }) => ({
        ...feature,
        properties: {
          ...properties,
          zips: Schema.decodeUnknownSync(PostalZips)(
            zcta.split(",").map((zip) => zip.trim()),
          ),
        },
      }),
    ),
  };
}
export type Geography = ReturnType<typeof parseGeography>;

export function pickupAreas(
  geography: Geography,
  zones: ReadonlyArray<typeof Zone.Type>,
) {
  const byZip = new Map(zones.map((zone) => [zone.zip, zone.trips]));
  const features = geography.features.map((feature) => {
    const zips = feature.properties.zips;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        trips: zips.reduce((sum, zip) => sum + (byZip.get(zip) ?? 0), 0),
        zip: zips.reduce(
          (selected, zip) =>
            (byZip.get(zip) ?? 0) > (byZip.get(selected) ?? 0) ? zip : selected,
          zips[0],
        ),
      },
    };
  });
  return {
    features,
    maximum: Math.max(
      1,
      ...features.map((feature) => feature.properties.trips),
    ),
    mapped: features.reduce(
      (sum, feature) => sum + feature.properties.trips,
      0,
    ),
  };
}
export type PickupProperties = ReturnType<
  typeof pickupAreas
>["features"][number]["properties"];

export const activityColors = [20, 40, 60, 80, 100].map(
  (amount) =>
    `color-mix(in oklab, var(--chart-color) ${amount}%, var(--surface))`,
);
