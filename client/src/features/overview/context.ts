import type { GenieContext } from "../../../../shared/domain";
import type { Model } from "./model";
export function overviewContext(model: Model): GenieContext {
  const overview = model.overview.data;
  return {
    page: "overview",
    title: "Trip overview",
    ...(overview && !model.overview.error
      ? {
          data: JSON.stringify({
            summary: overview.summary,
            dailyMetric: model.series,
            daily: overview.daily,
            hourly: overview.hourly,
            topPickupZIPs: overview.zones.slice(0, 5),
            queriedAt: overview.queriedAt,
          }),
        }
      : {}),
  };
}
