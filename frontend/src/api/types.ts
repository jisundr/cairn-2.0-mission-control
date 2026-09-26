// Mirrors server.py's JSON shapes (TokenMeteringApp.handle_api). Every
// response is enveloped as { data, meta: { generated_at } }.

export type RangeKey = "today" | "7d" | "30d" | "month" | "6m" | "life";

export interface Envelope<T> {
  data: T;
  meta: { generated_at: string };
}

export interface ProjectSummary {
  label: string;
}

export interface TimeseriesPoint {
  bucket: string;
  calls: number;
  tokens: number;
  cost: number | null;
}

export interface Timeseries {
  range: RangeKey;
  bucket: "hour" | "day";
  since: string;
  until: string;
  points: TimeseriesPoint[];
  total_tokens: number;
  total_cost: number | null;
}

export interface ModelCostRow {
  key: string;
  calls: number;
  tokens: number;
  cost: number | null;
}

export interface DayDetail {
  date: string;
  total_tokens: number;
  total_cost: number | null;
  by_model: ModelCostRow[];
}

export interface GroupRollupRow {
  key: string;
  calls: number;
  tokens: number;
  cost: number | null;
}

export interface CountRollupRow {
  key: string;
  count: number;
}

// Raw per-call row for the activity heatmap's range (the last 7 days) -
// ActivityHeatmap.tsx buckets these into day-of-week/hour cells itself,
// using each row's local `Date` fields rather than a server-computed UTC
// bucket, so a DST transition inside the range still lands correctly.
export interface HeatmapRow {
  timestamp: string;
  tokens: number;
}

export interface SessionSummary {
  session_id: string;
  project: string;
  started: string;
  ended: string;
  agents: string[];
  calls: number;
  tokens: number;
  cost: number | null;
  usage_limit_hit: boolean;
  label?: string;
}

export interface UsageLimitEvent {
  id: number;
  session_id: string;
  timestamp: string;
  raw_entry: string;
  project: string;
}

export interface TraceCall {
  position: number;
  global_position: number;
  request_id: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cost: number | "unknown";
  duration_seconds: number | null;
}

export interface AgentTrace {
  agent: string | null;
  calls: number;
  tokens: number;
  cost: number | null;
  trace: TraceCall[];
}

export interface SessionTrace {
  session_id: string;
  started: string;
  ended: string;
  agents: AgentTrace[];
  label?: string;
}

export interface CallDetail {
  position: number;
  total: number;
  session_id: string;
  project: string;
  agent: string | null;
  request_id: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cost: number | "unknown";
  available: boolean;
  prompt: string | null;
  response: string | null;
  tool_calls: { name: string; summary: string }[];
}

export interface ApiError {
  error: string;
  valid_ranges?: string[];
}
