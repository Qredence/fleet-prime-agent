import { defineComponent } from "@openuidev/react-lang"
import {
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  LineChart as RechartsLineChart,
  XAxis,
} from "recharts"
import { z } from "zod"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart"

const CHART_FALLBACK_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`)

function buildChartConfig(
  series: Array<{ dataKey: string; label: string; color?: string }>
) {
  const config: Record<string, { label: string; color: string }> = {}
  series.forEach((entry, index) => {
    config[entry.dataKey] = {
      label: entry.label,
      color:
        entry.color ??
        CHART_FALLBACK_COLORS[index % CHART_FALLBACK_COLORS.length]!,
    }
  })
  return config
}

function EmptyChartNotice() {
  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-border/50 text-[12px] text-foreground/40">
      No data
    </div>
  )
}

function LineChartComponent({
  props: { title, description, xAxisKey, series, data },
}: {
  props: {
    title: string
    description?: string
    xAxisKey: string
    series: Array<{ dataKey: string; label: string; color?: string }>
    data: Array<Record<string, string | number>>
  }
}) {
  const hasData = series.length > 0 && data.length > 0
  const chartConfig = buildChartConfig(series)

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChartNotice />
        ) : (
          <ChartContainer config={chartConfig} className="min-h-[240px] w-full">
            <RechartsLineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={xAxisKey}
                tickLine={false}
                tickMargin={10}
                axisLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.map((option) => (
                <Line
                  key={option.dataKey}
                  type="monotone"
                  dataKey={option.dataKey}
                  stroke={chartConfig[option.dataKey].color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </RechartsLineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export const LineChartDef = defineComponent({
  name: "LineChart",
  description: "A line chart for trends over time or ordered categories.",
  props: z.object({
    title: z.string().describe("The title of the chart"),
    description: z
      .string()
      .optional()
      .describe("A brief description of the chart"),
    xAxisKey: z
      .string()
      .describe(
        "The key in the data objects used for the X-axis (e.g. 'month', 'day')"
      ),
    series: z
      .array(
        z.object({
          dataKey: z
            .string()
            .describe("The key in the data object for this series"),
          label: z
            .string()
            .describe("Human-readable label for this series"),
          color: z
            .string()
            .optional()
            .describe("Optional CSS color override for this series"),
        })
      )
      .describe("The line series to plot"),
    data: z
      .array(z.record(z.string(), z.union([z.string(), z.number()])))
      .describe(
        "Data rows; ALWAYS generate realistic data when inventing datasets"
      ),
  }),
  component: LineChartComponent,
})

function DonutChartComponent({
  props: { title, description, segments, centerLabel },
}: {
  props: {
    title: string
    description?: string
    segments: Array<{ label: string; value: number; color?: string }>
    centerLabel?: string
  }
}) {
  const valid = segments.filter((segment) => segment.value > 0)
  const chartConfig = buildChartConfig(
    valid.map((segment) => ({
      dataKey: segment.label,
      label: segment.label,
      color: segment.color,
    }))
  )

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {valid.length === 0 ? (
          <EmptyChartNotice />
        ) : (
          <div className="relative">
            <ChartContainer
              config={chartConfig}
              className="min-h-[240px] w-full"
            >
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={valid}
                  nameKey="label"
                  dataKey="value"
                  innerRadius={55}
                  outerRadius={80}
                  strokeWidth={0}
                >
                  {valid.map((segment, index) => (
                    <Cell
                      key={segment.label}
                      fill={segment.color ?? CHART_FALLBACK_COLORS[index % 5]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            {centerLabel && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold">
                {centerLabel}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export const DonutChartDef = defineComponent({
  name: "DonutChart",
  description: "A donut/pie chart for part-of-whole composition.",
  props: z.object({
    title: z.string().describe("The title of the chart"),
    description: z.string().optional().describe("A brief description of the chart"),
    segments: z
      .array(
        z.object({
          label: z.string().describe("Segment name"),
          value: z.number().describe("Segment value (must be positive)"),
          color: z.string().optional().describe("Optional CSS color override for this segment"),
        })
      )
      .describe("The segments to plot"),
    centerLabel: z
      .string()
      .optional()
      .describe("Optional label rendered at the donut center"),
  }),
  component: DonutChartComponent,
})
