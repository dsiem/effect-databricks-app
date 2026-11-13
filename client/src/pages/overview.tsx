import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CarTaxiFront,
  CircleDollarSign,
  Route,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, money, number, useFilters, useOverview } from "../api";
import {
  ChartTitle,
  ErrorState,
  ExploreLink,
  Loading,
  PageTitle,
} from "../components/common";
import { Badge, Button, Card, cn } from "../components/ui";

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #e3e8e1",
  fontSize: 12,
  boxShadow: "0 6px 18px #172c2710",
};
export default function Overview() {
  const query = useOverview();
  const { query: filters } = useFilters();
  const [series, setSeries] = useState<"trips" | "revenue">("trips");
  const suffix = filters ? `?${filters}` : "";
  if (query.isPending)
    return (
      <>
        <PageTitle
          title="Trip overview"
          description="Aggregate trip counts, fares, distances, and durations for the selected filters."
        />
        <Loading />
      </>
    );
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const { summary, daily, hourly, zones } = query.data;
  const metrics = [
    {
      title: "Total trips",
      value: number(summary.trips),
      detail: "Recorded taxi trips",
      icon: CarTaxiFront,
    },
    {
      title: "Total fare revenue",
      value: money(summary.revenue),
      detail: "USD · excludes tips & tolls",
      icon: CircleDollarSign,
    },
    {
      title: "Average fare",
      value: money(summary.avg_fare, 2),
      detail: "Per recorded trip",
      icon: Activity,
    },
    {
      title: "Average distance",
      value: `${summary.avg_distance.toFixed(2)} mi`,
      detail: `${summary.avg_duration.toFixed(1)} min average duration`,
      icon: Route,
    },
  ];
  return (
    <>
      <PageTitle
        title="Trip overview"
        description="Aggregate trip counts, fares, distances, and durations for the selected filters."
        action={
          <Button variant="outline" asChild>
            <Link to={`/genie${suffix}`}>
              <Sparkles />
              Open Genie
              <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ title, value, detail, icon: Icon }, i) => (
          <Card
            key={title}
            className={cn(
              "relative overflow-hidden p-5",
              i === 0 && "border-[#cbd9bd] bg-[#edf3e8]",
            )}
          >
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{title}</p>
              <Icon
                className={cn(
                  "size-4",
                  i === 0 ? "text-primary" : "text-[#95a08e]",
                )}
              />
            </div>
            <p className="text-[29px] font-semibold tracking-[-.045em] tabular-nums">
              {value}
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">{detail}</p>
            {i === 0 && (
              <div className="absolute -bottom-6 -right-4 size-20 rounded-full border-[10px] border-primary/[.04]" />
            )}
          </Card>
        ))}
      </div>
      {summary.trips === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No trips match these filters. Try another date range or pickup ZIP.
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-5 xl:grid-cols-[1.75fr_1fr]">
            <Card className="min-w-0 p-5 lg:p-6">
              <ChartTitle
                title={
                  series === "trips"
                    ? "Trips by pickup date"
                    : "Fare revenue by pickup date"
                }
                subtitle={
                  series === "trips"
                    ? "Recorded trips over the selected period"
                    : "Fare revenue over the selected period"
                }
                action={
                  <div className="flex gap-1 rounded-lg bg-muted p-1">
                    {(["trips", "revenue"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={series === s}
                        onClick={() => setSeries(s)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-[10px] capitalize",
                          series === s && "bg-white font-medium shadow-sm",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <AreaChart
                    data={[...daily]}
                    margin={{ top: 10, right: 5, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="tripFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#85a870"
                          stopOpacity={0.28}
                        />
                        <stop
                          offset="100%"
                          stopColor="#85a870"
                          stopOpacity={0.01}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="#edf0e9"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(s: string) => s.slice(5)}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={35}
                      dy={10}
                    />
                    <YAxis
                      tickFormatter={compact}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value) =>
                        series === "revenue"
                          ? money(Number(value), 2)
                          : number(Number(value))
                      }
                    />
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey={series}
                      name={series === "trips" ? "Trips" : "Fare revenue"}
                      stroke="#567d46"
                      strokeWidth={2.5}
                      fill="url(#tripFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-5 flex items-center justify-between border-t pt-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#6b9155]" />
                  NYC yellow taxis
                </span>
                <span>{daily.length} days with recorded trips</span>
              </div>
            </Card>
            <Card className="min-w-0 p-5 lg:p-6">
              <ChartTitle
                title="Trips by pickup hour"
                subtitle="Trip distribution by pickup hour"
                action={<Badge>24 hours</Badge>}
              />
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={[...hourly]}
                    margin={{ top: 10, right: 0, left: -23, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="#edf0e9"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="hour"
                      axisLine={false}
                      tickLine={false}
                      interval={5}
                      tickFormatter={(h) => `${h}:00`}
                      dy={10}
                    />
                    <YAxis
                      tickFormatter={compact}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(h) => `${h}:00 pickup`}
                      formatter={(value) => number(Number(value))}
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey="trips"
                      name="Trips"
                      fill="#dfc458"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-5 flex items-center gap-2 border-t pt-4 text-[10px] text-muted-foreground">
                <span className="size-2 rounded-full bg-[#dfc458]" />
                Hours as recorded in the source
              </div>
            </Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.75fr_1fr]">
            <Card className="p-5 lg:p-6">
              <ChartTitle
                title="Top pickup ZIP codes"
                subtitle="Top pickup ZIP codes by trip volume"
                action={
                  <ExploreLink to={`/map${suffix}`}>
                    View pickup map
                  </ExploreLink>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="pb-3 font-normal">Pickup ZIP</th>
                      <th className="pb-3 text-right font-normal">Trips</th>
                      <th className="pb-3 text-right font-normal">
                        Fare revenue
                      </th>
                      <th className="pb-3 text-right font-normal">Avg. fare</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {zones.slice(0, 5).map((zone, index) => (
                      <tr key={zone.zip} className="border-b last:border-0">
                        <td className="py-3.5">
                          <span className="mr-3 text-[10px] text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="font-medium">{zone.zip}</span>
                        </td>
                        <td className="text-right tabular-nums">
                          {number(zone.trips)}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(zone.revenue)}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(zone.avg_fare, 2)}
                        </td>
                        <td className="text-right">
                          <Link
                            aria-label={`View trips in ${zone.zip}`}
                            to={`/trips?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(filters)), zip: zone.zip })}`}
                          >
                            <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="relative flex flex-col overflow-hidden border-[#cedac8] bg-[#eaf0e4] p-6">
              <div className="absolute -right-8 -top-10 size-44 rounded-full border-[25px] border-white/30" />
              <div className="relative">
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-white/60">
                  <Sparkles className="size-5 text-primary" />
                </span>
                <Badge className="ml-3 bg-white/50 text-primary">
                  DATABRICKS GENIE
                </Badge>
                <h2 className="mt-6 max-w-52 text-2xl font-semibold leading-tight tracking-tight">
                  Natural language queries
                </h2>
                <p className="mt-3 max-w-64 text-xs leading-6 text-[#738069]">
                  Query trip counts, fares, and pickup patterns using natural
                  language.
                </p>
              </div>
              <Link
                to={`/genie${suffix}`}
                className="relative mt-7 inline-flex items-center gap-3 text-xs font-semibold text-primary"
              >
                Open Genie
                <ArrowRight className="size-4" />
              </Link>
            </Card>
          </div>
        </>
      )}
      <p className="mt-4 text-right text-[10px] text-muted-foreground">
        Queried {new Date(query.data.queriedAt).toLocaleTimeString()} · Results
        cached for 60 seconds
      </p>
    </>
  );
}
