import {
  createLibrary,
  defineComponent,
  reactive,
  useStateField,
  useTriggerAction,
} from "@openuidev/react-lang"
import {
  Bar,
  CartesianGrid,
  BarChart as RechartsBarChart,
  XAxis,
  YAxis,
} from "recharts"
import { useId } from "react"
import { z } from "zod"
import { Alert, AlertDescription, AlertTitle } from "../alert"
import { Badge } from "../badge"
import { Button } from "../button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  getChartColorVarName,
} from "../chart"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../dialog"
import { Field, FieldLabel } from "../field"
import { Input } from "../input"
import { Progress, ProgressLabel, ProgressValue } from "../progress"
import { Select } from "../select"
import { Separator } from "../separator"
import { Switch } from "../switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../table"
import { cn } from "../../lib/utils"
import {
  badgeToneClasses,
  badgeVariantsByTone,
  openUITextToneSchema,
  openUIToneSchema,
  textToneClasses,
  toneClasses,
} from "./tones"

const gapClasses = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const

const widthClasses = {
  compact: "max-w-md",
  normal: "max-w-2xl",
  wide: "max-w-4xl",
  full: "max-w-none",
} as const

const commonTone = z.enum(openUIToneSchema).optional().default("default")

const textTone = z.enum(openUITextToneSchema).optional().default("default")

const gapSizeSchema = z.enum(["sm", "md", "lg", "xl"]).optional().default("md")

const childrenProp = z
  .any()
  .optional()
  .describe("Child component, array of child components, or plain content")

export const ButtonDef = defineComponent({
  name: "Button",
  description:
    "A button that triggers interactive actions or conversational updates.",
  props: z.object({
    label: z.string().describe("Visible button label"),
    action: z
      .any()
      .optional()
      .describe(
        "Message string, action, or action composition to run on click. Defaults to label."
      ),
    variant: z
      .enum(["default", "destructive", "outline", "secondary", "ghost", "link"])
      .optional()
      .default("default")
      .describe("Visual style"),
  }),
  component: ({ props: { label, action, variant } }) => {
    const triggerAction = useTriggerAction()

    const handleClick = () => {
      if (!action) {
        void triggerAction(label)
        return
      }

      if (typeof action === "string") {
        void triggerAction(action)
      } else {
        void triggerAction(label, undefined, action)
      }
    }

    return (
      <Button type="button" variant={variant} onClick={handleClick}>
        {label}
      </Button>
    )
  },
})

export const TextDef = defineComponent({
  name: "Text",
  description: "Short body text for cards, captions, and summaries.",
  props: z.object({
    text: z.string().describe("Text to display"),
    tone: textTone,
    size: z.enum(["sm", "md", "lg"]).optional().default("md"),
  }),
  component: ({ props: { text, tone, size } }) => {
    const sizeClass = { sm: "text-xs", md: "text-sm", lg: "text-base" }[size]

    return <p className={cn(sizeClass, textToneClasses[tone])}>{text}</p>
  },
})

export const HeadingDef = defineComponent({
  name: "Heading",
  description: "Section heading text.",
  props: z.object({
    text: z.string().describe("Heading text"),
    level: z.number().int().min(1).max(4).optional().default(3),
  }),
  component: ({ props: { text, level } }) => {
    if (level === 1) {
      return <h1 className="text-2xl font-semibold tracking-tight">{text}</h1>
    }
    if (level === 2) {
      return <h2 className="text-xl font-semibold tracking-tight">{text}</h2>
    }
    if (level === 4) {
      return <h4 className="text-base font-semibold tracking-tight">{text}</h4>
    }
    return <h3 className="text-lg font-semibold tracking-tight">{text}</h3>
  },
})

export const BadgeDef = defineComponent({
  name: "Badge",
  description: "Small status badge.",
  props: z.object({
    label: z.string().describe("Badge label"),
    tone: commonTone,
  }),
  component: ({ props: { label, tone } }) => {
    return (
      <Badge
        variant={badgeVariantsByTone[tone]}
        className={badgeToneClasses[tone]}
      >
        {label}
      </Badge>
    )
  },
})

export const InputDef = defineComponent({
  name: "Input",
  description: "An interactive, state-bound text input.",
  props: z.object({
    name: z.string().describe("Form field name for state tracking"),
    value: reactive(z.string().describe("Bound state variable")),
    placeholder: z.string().optional(),
    type: z.enum(["text", "email", "number", "password", "search"]).optional(),
    disabled: z.boolean().optional().default(false),
  }),
  component: ({ props: { name, value, placeholder, type, disabled } }) => {
    const field = useStateField(name, value)
    const controlId = useId()

    return (
      <Field orientation="vertical" className="gap-1.5">
        <FieldLabel htmlFor={controlId} className="sr-only">
          {name}
        </FieldLabel>
        <Input
          id={controlId}
          value={field.value}
          onChange={(e) => field.setValue(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          type={type}
        />
      </Field>
    )
  },
})

export const CardDef = defineComponent({
  name: "Card",
  description: "A chat-sized card container for structured information.",
  props: z.object({
    title: z.string().describe("Card title"),
    content: childrenProp,
    tone: commonTone,
    width: z
      .enum(["compact", "normal", "wide", "full"])
      .optional()
      .default("normal"),
  }),
  component: ({ props: { title, content, tone, width }, renderNode }) => {
    return (
      <Card className={cn("w-full", widthClasses[width], toneClasses[tone])}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">{renderNode(content)}</CardContent>
      </Card>
    )
  },
})

export const CalloutDef = defineComponent({
  name: "Callout",
  description: "Highlighted note, warning, success, or error message.",
  props: z.object({
    title: z.string(),
    content: childrenProp,
    tone: commonTone,
  }),
  component: ({ props: { title, content, tone }, renderNode }) => {
    return (
      <Alert
        variant={tone === "danger" ? "destructive" : "default"}
        className={cn("w-full", tone !== "danger" && toneClasses[tone])}
      >
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{renderNode(content)}</AlertDescription>
      </Alert>
    )
  },
})

export const KeyValueDef = defineComponent({
  name: "KeyValue",
  description: "A single label/value row.",
  props: z.object({
    label: z.string(),
    value: z.string(),
  }),
  component: ({ props: { label, value } }) => {
    return (
      <div className="flex w-full items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right font-medium">{value}</span>
      </div>
    )
  },
})

export const MetricDef = defineComponent({
  name: "Metric",
  description: "A compact KPI metric card.",
  props: z.object({
    label: z.string(),
    value: z.string(),
    trend: z.string().optional(),
    tone: commonTone,
  }),
  component: ({ props: { label, value, trend, tone } }) => {
    return (
      <Card size="sm" className={toneClasses[tone]}>
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </CardHeader>
        {trend && (
          <CardContent className="text-xs text-muted-foreground">
            {trend}
          </CardContent>
        )}
      </Card>
    )
  },
})

export const ProgressBarDef = defineComponent({
  name: "ProgressBar",
  description: "Progress indicator with a label.",
  props: z.object({
    label: z.string(),
    value: z.number().min(0).max(100),
  }),
  component: ({ props: { label, value } }) => {
    return (
      <Progress value={value} className="w-full">
        <div className="flex justify-between text-xs">
          <ProgressLabel className="text-xs text-muted-foreground">
            {label}
          </ProgressLabel>
          <ProgressValue className="text-xs font-medium">
            {(_, progressValue) => `${progressValue ?? value}%`}
          </ProgressValue>
        </div>
      </Progress>
    )
  },
})

export const ListDef = defineComponent({
  name: "List",
  description: "Bulleted or numbered text list.",
  props: z.object({
    items: z.array(z.string()),
    ordered: z.boolean().optional().default(false),
  }),
  component: ({ props: { items, ordered } }) => {
    const Tag = ordered ? "ol" : "ul"
    return (
      <Tag
        className={cn(
          "flex flex-col gap-1 pl-5 text-sm",
          ordered ? "list-decimal" : "list-disc"
        )}
      >
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </Tag>
    )
  },
})

export const CodeBlockDef = defineComponent({
  name: "CodeBlock",
  description: "Short preformatted code or command output.",
  props: z.object({
    code: z.string(),
    language: z.string().optional(),
  }),
  component: ({ props: { code, language } }) => {
    return (
      <pre className="w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs">
        {language && (
          <div className="mb-2 text-[10px] text-muted-foreground uppercase">
            {language}
          </div>
        )}
        <code>{code}</code>
      </pre>
    )
  },
})

export const DividerDef = defineComponent({
  name: "Divider",
  description: "Horizontal divider with an optional label.",
  props: z.object({
    label: z.string().optional(),
  }),
  component: ({ props: { label } }) => {
    return (
      <div className="flex w-full items-center gap-3">
        <Separator className="flex-1" />
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <Separator className="flex-1" />
      </div>
    )
  },
})

export const TableDef = defineComponent({
  name: "Table",
  description: "Small data table for comparisons and summaries.",
  props: z.object({
    columns: z.array(z.string()).describe("Column headings"),
    rows: z.array(z.array(z.string())).describe("Rows matching the columns"),
  }),
  component: ({ props: { columns, rows } }) => {
    return (
      <div className="w-full overflow-x-auto rounded-lg border">
        <Table className="min-w-max">
          <TableHeader className="bg-muted/60">
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={`${rowIndex}-${cellIndex}`}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  },
})

export const BarChartDef = defineComponent({
  name: "BarChart",
  description:
    "A bar chart for visualizing comparisons or trends using explicitly provided data points.",
  props: z.object({
    title: z.string().describe("The title of the chart"),
    description: z
      .string()
      .optional()
      .describe("A brief description of the chart"),
    xAxisKey: z
      .string()
      .describe(
        "The key from the data objects to use for the X-axis (e.g. 'year', 'month', 'country')"
      ),
    series: z
      .array(
        z.object({
          dataKey: z
            .string()
            .describe("The key in the data object for this series"),
          label: z
            .string()
            .describe(
              "The human readable label for this series (e.g. 'United States', 'China')"
            ),
        })
      )
      .describe("The data series to plot as bars"),
    data: z
      .array(z.record(z.string(), z.union([z.string(), z.number()])))
      .describe(
        "The actual data points to plot. ALWAYS generate realistic data if asked to compare things like US vs China population."
      ),
  }),
  component: ({ props: { title, description, xAxisKey, series, data } }) => {
    const chartConfig: Record<string, { label: string; color: string }> = {}
    series.forEach((s, index) => {
      chartConfig[s.dataKey] = {
        label: s.label,
        color: `var(--chart-${(index % 5) + 1})`,
      }
    })

    return (
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
            <RechartsBarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={xAxisKey}
                tickLine={false}
                tickMargin={10}
                axisLine={false}
              />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((s) => (
                <Bar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  fill={`var(${getChartColorVarName(s.dataKey)})`}
                  radius={4}
                />
              ))}
            </RechartsBarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    )
  },
})

export const RootDef = defineComponent({
  name: "Root",
  description:
    "The root container for the generated UI. Must be used as the top-level component.",
  props: z.object({
    children: childrenProp,
  }),
  component: ({ props: { children }, renderNode }) => {
    return (
      <div className="flex w-full flex-col items-start gap-4">
        {renderNode(children)}
      </div>
    )
  },
})

export const StackDef = defineComponent({
  name: "Stack",
  description:
    "A flexbox layout component for stacking children vertically or horizontally.",
  props: z.object({
    children: childrenProp,
    direction: z
      .enum(["row", "column"])
      .optional()
      .default("column")
      .describe("The flex direction"),
    gap: gapSizeSchema,
  }),
  component: ({ props: { children, direction, gap }, renderNode }) => {
    const dirClass = direction === "row" ? "flex-row" : "flex-col"
    return (
      <div className={cn("flex w-full", dirClass, gapClasses[gap])}>
        {renderNode(children)}
      </div>
    )
  },
})

export const GroupDef = defineComponent({
  name: "Group",
  description:
    "A wrapping horizontal group for badges, buttons, or short items.",
  props: z.object({
    children: childrenProp,
    gap: gapSizeSchema,
  }),
  component: ({ props: { children, gap }, renderNode }) => {
    return (
      <div className={cn("flex flex-wrap items-center", gapClasses[gap])}>
        {renderNode(children)}
      </div>
    )
  },
})

export const GridDef = defineComponent({
  name: "Grid",
  description: "A CSS grid layout component.",
  props: z.object({
    children: childrenProp,
    cols: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .default(2)
      .describe("Number of columns"),
    gap: gapSizeSchema,
  }),
  component: ({ props: { children, cols, gap }, renderNode }) => {
    const gridColsClass = {
      1: "grid-cols-1",
      2: "grid-cols-2",
      3: "grid-cols-3",
      4: "grid-cols-4",
      5: "grid-cols-5",
      6: "grid-cols-6",
      7: "grid-cols-7",
      8: "grid-cols-8",
      9: "grid-cols-9",
      10: "grid-cols-10",
      11: "grid-cols-11",
      12: "grid-cols-12",
    }[cols]

    return (
      <div className={cn("grid w-full", gridColsClass, gapClasses[gap])}>
        {renderNode(children)}
      </div>
    )
  },
})

export const SelectDef = defineComponent({
  name: "Select",
  description: "An interactive dropdown selector with reactive state binding.",
  props: z.object({
    name: z.string().describe("Form field name for state tracking"),
    value: reactive(z.string().describe("Bound state variable")),
    options: z
      .array(
        z.object({
          value: z.string().describe("Option value"),
          label: z.string().describe("Visible label"),
          disabled: z.boolean().optional(),
        })
      )
      .describe("Select options"),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder when no value selected"),
  }),
  component: ({ props: { name, value, options, placeholder } }) => {
    const field = useStateField(name, value)
    const controlId = useId()

    return (
      <Field orientation="vertical" className="gap-1.5">
        <FieldLabel htmlFor={controlId} className="sr-only">
          {name}
        </FieldLabel>
        <Select
          options={options}
          triggerId={controlId}
          value={field.value}
          onValueChange={(nextValue) => field.setValue(nextValue)}
          placeholder={placeholder}
        />
      </Field>
    )
  },
})

export const SwitchDef = defineComponent({
  name: "Switch",
  description: "A toggle switch component bound to a boolean reactive state.",
  props: z.object({
    name: z.string().describe("Form field name for state tracking"),
    checked: reactive(z.boolean().describe("Bound boolean state variable")),
    label: z.string().optional().describe("Label shown next to the switch"),
    disabled: z.boolean().optional().default(false),
  }),
  component: ({ props: { name, checked, label, disabled } }) => {
    const field = useStateField(name, checked)
    const isChecked = Boolean(field.value)
    const controlId = useId()

    return (
      <Field orientation="horizontal" className="items-center gap-2">
        <Switch
          id={controlId}
          checked={isChecked}
          onCheckedChange={(nextChecked) => field.setValue(nextChecked)}
          disabled={disabled}
          aria-label={label ? undefined : name}
        />
        {label ? <FieldLabel htmlFor={controlId}>{label}</FieldLabel> : null}
      </Field>
    )
  },
})

export const ModalDef = defineComponent({
  name: "Modal",
  description: "An overlay dialog container bound to a boolean reactive state.",
  props: z.object({
    name: z.string().describe("Unique modal name for state tracking"),
    open: reactive(
      z
        .boolean()
        .describe("Bound boolean state variable controlling visibility")
    ),
    title: z.string().describe("Modal header title"),
    content: childrenProp.describe("Modal body content"),
  }),
  component: ({ props: { name, open, title, content }, renderNode }) => {
    const field = useStateField(name, open)
    const isOpen = Boolean(field.value)

    return (
      <Dialog
        open={isOpen}
        onOpenChange={(nextOpen) => field.setValue(nextOpen)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="py-2">{renderNode(content)}</div>
        </DialogContent>
      </Dialog>
    )
  },
})

export const openUILibrary = createLibrary({
  components: [
    RootDef,
    StackDef,
    GridDef,
    GroupDef,
    DividerDef,
    HeadingDef,
    TextDef,
    ButtonDef,
    InputDef,
    CardDef,
    BadgeDef,
    CalloutDef,
    KeyValueDef,
    MetricDef,
    ProgressBarDef,
    ListDef,
    CodeBlockDef,
    TableDef,
    BarChartDef,
    SelectDef,
    SwitchDef,
    ModalDef,
  ],
})
