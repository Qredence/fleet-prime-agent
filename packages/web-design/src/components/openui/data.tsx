import { defineComponent } from "@openuidev/react-lang"
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import { useState } from "react"
import { Area, AreaChart } from "recharts"
import { z } from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "../card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../table"
import { cn } from "../../lib/utils"

type SortDirection = "asc" | "desc"

type SortState = {
  key: string
  dir: SortDirection
}

type DataColumnType = "text" | "number" | "currency" | "percent"

type DataColumn = {
  key: string
  label: string
  type?: DataColumnType
  align?: "left" | "right"
}

const NUMBER_FAMILY_TYPES: ReadonlyArray<DataColumnType> = [
  "number",
  "currency",
  "percent",
]

const textCollator = new Intl.Collator(undefined, { numeric: true })

const alignClasses = {
  left: "text-left",
  right: "text-right",
} as const

/** @internal formatting helper — unit-asserted by scripts/openui-render-check.tsx */
export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

/** @internal formatting helper — unit-asserted by scripts/openui-render-check.tsx */
export function formatPercent(value: number) {
  const normalized = Math.abs(value) >= 1 ? value / 100 : value
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(normalized)
}

/** @internal header-click cycle: null → {key, asc} → {key, desc} → null; a new key starts on asc */
export function cycleSortState(
  key: string,
  current: SortState | null
): SortState | null {
  if (!current || current.key !== key) {
    return { key, dir: "asc" }
  }
  if (current.dir === "asc") {
    return { key, dir: "desc" }
  }
  return null
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** @internal text uses Intl.Collator(numeric); number-family compares Number coercions; non-numeric rows sort last in BOTH directions */
export function buildSortComparator(
  column: {
    key: string
    type?: DataColumnType
  },
  dir: SortDirection = "asc"
) {
  const type = column.type ?? "text"
  const direction = dir === "asc" ? 1 : -1
  return (
    first: Record<string, string | number>,
    second: Record<string, string | number>
  ) => {
    const firstValue = first[column.key]
    const secondValue = second[column.key]
    if (type === "text") {
      return (
        direction *
        textCollator.compare(
          String(firstValue ?? ""),
          String(secondValue ?? "")
        )
      )
    }
    const firstNumber = toNumericValue(firstValue)
    const secondNumber = toNumericValue(secondValue)
    // Partition before direction: non-numeric rows always sort last.
    if (firstNumber === null && secondNumber === null) {
      return 0
    }
    if (firstNumber === null) {
      return 1
    }
    if (secondNumber === null) {
      return -1
    }
    return direction * (firstNumber - secondNumber)
  }
}

function formatCellValue(value: string | number, type?: DataColumnType) {
  const numeric = toNumericValue(value)
  if (type === "currency" && numeric !== null) {
    return formatCurrency(numeric)
  }
  if (type === "percent" && numeric !== null) {
    return formatPercent(numeric)
  }
  return String(value)
}

function resolveColumnAlign(column: DataColumn) {
  if (column.align) {
    return column.align
  }
  return column.type && NUMBER_FAMILY_TYPES.includes(column.type)
    ? "right"
    : "left"
}

function DataTableComponent({
  props: { title, columns, rows },
}: {
  props: {
    title?: string
    columns: DataColumn[]
    rows: Array<Record<string, string | number>>
  }
}) {
  const [sort, setSort] = useState<SortState | null>(null)

  let sortedRows = rows
  if (sort) {
    const activeColumn =
      columns.find((column) => column.key === sort.key) ?? { key: sort.key }
    const comparator = buildSortComparator(activeColumn, sort.dir)
    sortedRows = [...rows].sort(comparator)
  }

  return (
    <Card className={cn("w-full max-w-3xl")}>
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <div className="w-full overflow-x-auto rounded-lg border">
          <Table className="min-w-max">
            <TableHeader className="bg-muted/60">
              <TableRow>
                {columns.map((column) => {
                  const align = resolveColumnAlign(column)
                  const isActive = sort?.key === column.key
                  return (
                    <TableHead key={column.key} className={alignClasses[align]}>
                      <button
                        type="button"
                        onClick={() =>
                          setSort((current) =>
                            cycleSortState(column.key, current)
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 font-medium",
                          align === "right" && "flex-row-reverse",
                          isActive
                            ? "text-foreground"
                            : "text-foreground/60 hover:text-foreground"
                        )}
                      >
                        {column.label}
                        {isActive &&
                          (sort.dir === "asc" ? (
                            <IconChevronUp className="size-3.5" />
                          ) : (
                            <IconChevronDown className="size-3.5" />
                          ))}
                      </button>
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={Math.max(columns.length, 1)}
                    className="text-center text-foreground/40"
                  >
                    No data
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {columns.map((column) => {
                      const align = resolveColumnAlign(column)
                      return (
                        <TableCell
                          key={column.key}
                          className={cn(
                            alignClasses[align],
                            column.type &&
                              NUMBER_FAMILY_TYPES.includes(column.type) &&
                              "tabular-nums"
                          )}
                        >
                          {formatCellValue(row[column.key] ?? "", column.type)}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export const DataTableDef = defineComponent({
  name: "DataTable",
  description:
    "A data table with typed columns (text, number, currency, percent), formatted values, and click-to-sort headers.",
  props: z.object({
    title: z
      .string()
      .optional()
      .describe("Optional title shown above the table"),
    columns: z
      .array(
        z.object({
          key: z
            .string()
            .describe("The key in each row object for this column"),
          label: z.string().describe("Human-readable column header"),
          type: z
            .enum(["text", "number", "currency", "percent"])
            .optional()
            .describe(
              "Value type; controls value formatting and default cell alignment (number-family types align right)"
            ),
          align: z
            .enum(["left", "right"])
            .optional()
            .describe("Optional alignment override for this column"),
        })
      )
      .describe("Column definitions, in display order"),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number()])))
      .describe(
        "Data rows; object keys must match the column keys. ALWAYS provide realistic data when inventing datasets"
      ),
  }),
  component: DataTableComponent,
})

const deltaToneClasses = {
  up: "bg-emerald-500/10 text-emerald-500",
  down: "bg-red-500/10 text-red-500",
  neutral: "bg-foreground/10 text-foreground/50",
} as const

const SPARKLINE_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`)

type MetricGroupItem = {
  label: string
  value: string
  delta?: string
  deltaTone?: "up" | "down" | "neutral"
  sparkline?: Array<number>
}

function MetricGroupComponent({
  props: { metrics },
}: {
  props: { metrics: Array<MetricGroupItem> }
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {metrics.map((metric, index) => (
        <Card key={metric.label} className="gap-1 py-3">
          <CardContent className="flex flex-col gap-1 px-3">
            <span className="text-[11px] font-medium text-foreground/50">
              {metric.label}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold text-foreground">
                {metric.value}
              </span>
              {metric.delta ? (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    deltaToneClasses[metric.deltaTone ?? "neutral"]
                  )}
                >
                  {metric.delta}
                </span>
              ) : null}
            </div>
            {metric.sparkline && metric.sparkline.length >= 2 ? (
              <AreaChart
                width={48}
                height={16}
                data={metric.sparkline.map((point, i) => ({ i, v: point }))}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={SPARKLINE_COLORS[index % SPARKLINE_COLORS.length]}
                  strokeWidth={1}
                  fill={SPARKLINE_COLORS[index % SPARKLINE_COLORS.length]}
                  fillOpacity={0.15}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export const MetricGroupDef = defineComponent({
  name: "MetricGroup",
  description:
    "A compact group of KPI cards with optional deltas and trend sparklines.",
  props: z.object({
    metrics: z
      .array(
        z.object({
          label: z.string().describe("Short metric label"),
          value: z.string().describe("Formatted display value"),
          delta: z
            .string()
            .optional()
            .describe("Optional period-over-period change label"),
          deltaTone: z
            .enum(["up", "down", "neutral"])
            .optional()
            .describe("Visual tone for the delta"),
          sparkline: z
            .array(z.number())
            .optional()
            .describe("Optional values for a compact trend sparkline"),
        })
      )
      .describe("Metric cards to display"),
  }),
  component: MetricGroupComponent,
})
