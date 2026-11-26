// What POST /api/multi-chart returns (the Benchmark list's combined chart).
import type { ModelConfig } from "@/lib/api";
import type { ChartPoint } from "@/lib/chartMetrics";
import type { Difficulty } from "@/lib/difficulty";

/** one database benchmark in the combined chart, with the Benchmark list rows it stands for */
export interface Series {
  id: string;                 // database benchmark id
  label: string;              // the Benchmark list name (first row that links to it)
  root: string | null;        // its parent benchmark's name when that row is a sub-benchmark
  difficulty: Difficulty;     // the row's level (a benchmark's overall table: the span of its sub-benchmarks, span = true)
  span: boolean;
  db: string;                 // database name · version
  nos: string[];              // Benchmark list rows (No) that link to it
  results: number;
  sources: string[];
}
export interface MultiChartData {
  series: Series[];
  unlinked: { no: string; name: string }[];    // rows with no results in the database
  configs: ModelConfig[];
  selected: string[];
  defaults: string[];
  defaultNote: string;
  yugos: string[];
  points: ChartPoint[];
  customColors: Record<string, string>;
}
