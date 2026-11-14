import {
  Activity,
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
  ErrorState,
  ExploreLink,
  Loading,
  PageTitle,
} from "../components/common";
import { AskGenieButton } from "../components/genie/helper";
import { useGeniePage } from "../components/genie/provider";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";

const tooltipStyle = {
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
};

export default function Overview() {
  const query = useOverview();
  const { query: filters } = useFilters();
  const [series, setSeries] = useState<"trips" | "revenue">("trips");
  const suffix = filters ? `?${filters}` : "";
  useGeniePage({
    page: "overview",
    title: "Trip overview",
    ...(query.data && !query.error
      ? {
          data: JSON.stringify({
            summary: query.data.summary,
            dailyMetric: series,
            daily: query.data.daily,
            hourly: query.data.hourly,
            topPickupZIPs: query.data.zones.slice(0, 5),
            queriedAt: query.data.queriedAt,
          }),
        }
      : {}),
  });
  if (query.isPending)
    return (
      <>
        <PageTitle
          title="Trip overview"
          description="Trip activity, fares, and pickup patterns at a glance."
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
        description="Trip activity, fares, and pickup patterns at a glance."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ title, value, detail, icon: Icon }) => (
          <Card key={title} className="gap-2">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {summary.trips === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No trips match these filters. Try another date range or pickup ZIP.
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 xl:grid-cols-[1.75fr_1fr]">
            <Card className="min-w-0">
              <Tabs
                value={series}
                onValueChange={(value) => {
                  if (value === "trips" || value === "revenue")
                    setSeries(value);
                }}
                className="gap-6"
              >
                <CardHeader>
                  <CardTitle role="heading" aria-level={2}>
                    {series === "trips"
                      ? "Trips by pickup date"
                      : "Fare revenue by pickup date"}
                  </CardTitle>
                  <CardDescription>
                    Activity over the selected period
                  </CardDescription>
                  <CardAction>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AskGenieButton
                        context={{
                          page: "overview",
                          title:
                            series === "trips"
                              ? "Trips by pickup date"
                              : "Fare revenue by pickup date",
                          data: JSON.stringify({
                            metric: series,
                            daily,
                            queriedAt: query.data.queriedAt,
                          }),
                        }}
                        question="Explain the pattern in this chart and highlight any unusual days."
                      >
                        Explain
                      </AskGenieButton>
                      <TabsList aria-label="Daily chart metric">
                        <TabsTrigger value="trips">Trips</TabsTrigger>
                        <TabsTrigger value="revenue">Revenue</TabsTrigger>
                      </TabsList>
                    </div>
                  </CardAction>
                </CardHeader>
                <TabsContent value={series} className="px-6">
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <AreaChart
                        data={[...daily]}
                        margin={{ top: 10, right: 5, left: -16, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="tripFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="var(--chart-1)"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="100%"
                              stopColor="var(--chart-1)"
                              stopOpacity={0.03}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
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
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          fill="url(#tripFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </TabsContent>
              </Tabs>
              <CardFooter className="flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-chart-1" />
                  NYC yellow taxis
                </span>
                <span>{daily.length} days with recorded trips</span>
              </CardFooter>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Trips by pickup hour
                </CardTitle>
                <CardDescription>Distribution across the day</CardDescription>
                <CardAction>
                  <AskGenieButton
                    context={{
                      page: "overview",
                      title: "Trips by pickup hour",
                      data: JSON.stringify({
                        hourly,
                        queriedAt: query.data.queriedAt,
                      }),
                    }}
                    question="Explain this hourly pickup pattern. Which hours stand out?"
                  >
                    Explain
                  </AskGenieButton>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer>
                    <BarChart
                      data={[...hourly]}
                      margin={{ top: 10, right: 0, left: -23, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" />
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
                        fill="var(--chart-2)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
              <CardFooter className="gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-chart-2" />
                Hours as recorded in the source
              </CardFooter>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Top pickup ZIP codes
                </CardTitle>
                <CardDescription>
                  Pickup areas ranked by trip volume
                </CardDescription>
                <CardAction>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <AskGenieButton
                      context={{
                        page: "overview",
                        title: "Top pickup ZIP codes",
                        data: JSON.stringify({
                          topPickupZIPs: zones.slice(0, 5),
                          queriedAt: query.data.queriedAt,
                        }),
                      }}
                      question="Compare these pickup ZIP codes by trip volume and average fare."
                    >
                      Compare
                    </AskGenieButton>
                    <ExploreLink to={`/map${suffix}`}>
                      View pickup map
                    </ExploreLink>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pickup ZIP</TableHead>
                      <TableHead className="text-right">Trips</TableHead>
                      <TableHead className="text-right">Fare revenue</TableHead>
                      <TableHead className="text-right">Avg. fare</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">Explore</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.slice(0, 5).map((zone, index) => (
                      <TableRow key={zone.zip}>
                        <TableCell className="font-medium">
                          <span className="mr-3 text-xs text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {zone.zip}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number(zone.trips)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(zone.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(zone.avg_fare, 2)}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link
                              aria-label={`View trips in ${zone.zip}`}
                              to={`/trips?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(filters)), zip: zone.zip })}`}
                            >
                              <ArrowUpRight />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-muted">
                  <Sparkles className="size-5" />
                </div>
                <CardTitle role="heading" aria-level={2}>
                  Take the next analytical step
                </CardTitle>
                <CardDescription>
                  Ask Genie to explain this view or explore a new angle with the
                  same filters.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-sm text-muted-foreground">
                Compare periods, investigate unusual fares, or break down a
                pattern. Review the results and SQL alongside your dashboard.
              </CardContent>
              <CardFooter>
                <AskGenieButton question="Compare weekday and weekend trip activity for this view.">
                  Explore with Genie
                </AskGenieButton>
              </CardFooter>
            </Card>
          </div>
        </>
      )}
      <p className="mt-4 text-right text-xs text-muted-foreground">
        Queried {new Date(query.data.queriedAt).toLocaleTimeString()} · Results
        cached for 60 seconds
      </p>
    </>
  );
}
