"use client";

import { useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActivityPoint } from "@/lib/tracker/types";

import { compactNumber, preciseNumber } from "./format";

interface ActivityChartProps {
  data: ActivityPoint[];
  rangeLabel: string;
}

export function ActivityChart({ data, rangeLabel }: ActivityChartProps) {
  const reduceMotion = useReducedMotion();
  const description = `Weighted engagement captured by tracked posts over ${rangeLabel}.`;

  return (
    <figure className="signal-chart" aria-labelledby="activity-chart-title">
      <figcaption className="sr-only" id="activity-chart-title">
        {description}
      </figcaption>
      <div className="h-64 w-full min-w-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 14, right: 8, bottom: 0, left: -14 }}
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id="signalArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--signal-chart)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--signal-chart)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--signal-grid)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--signal-muted)", fontSize: 12 }}
              tickMargin={10}
              minTickGap={24}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--signal-muted)", fontSize: 12 }}
              tickFormatter={compactNumber}
              width={54}
            />
            <RechartsTooltip
              cursor={{ stroke: "var(--signal-axis)", strokeWidth: 1 }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--signal-border)",
                background: "var(--signal-tooltip)",
                color: "var(--signal-text)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.16)",
              }}
              formatter={(value) => [
                preciseNumber(Number(value ?? 0)),
                "Weighted engagement",
              ]}
              labelFormatter={(label) => `${label}`}
            />
            <Area
              type="monotone"
              dataKey="engagement"
              stroke="var(--signal-chart)"
              strokeWidth={2}
              fill="url(#signalArea)"
              isAnimationActive={!reduceMotion}
              animationDuration={650}
              activeDot={{
                r: 5,
                fill: "var(--signal-chart)",
                stroke: "var(--signal-surface)",
                strokeWidth: 2,
              }}
              dot={
                data.length <= 14
                  ? {
                      r: 4,
                      fill: "var(--signal-chart)",
                      stroke: "var(--signal-surface)",
                      strokeWidth: 2,
                    }
                  : false
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          View activity table
        </summary>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Period starting</TableHead>
              <TableHead className="text-right">Weighted engagement</TableHead>
              <TableHead className="text-right">Reply opportunities</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((point) => (
              <TableRow key={point.date}>
                <TableCell>{point.date}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {preciseNumber(point.engagement)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {point.opportunities}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
