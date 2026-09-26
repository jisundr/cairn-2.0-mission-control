export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatCost(cost: number | "unknown" | null): string {
  if (cost === null || cost === "unknown") return "unknown*";
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  return `${seconds.toFixed(1)}s`;
}

export function formatTimeOfDay(iso: string): string {
  // ISO strings from server.py are UTC ("...Z"); Date's local-time getters
  // render the viewer's own time zone, which the browser already knows.
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatDayLabel(dateStr: string): string {
  // dateStr: "YYYY-MM-DD"
  const [, month, day] = dateStr.split("-");
  return `${month}-${day}`;
}

// Fallback label for a session with no saved title yet (parser.py found no
// "ai-title" record) - first 8 chars of the session's full UUID, matching
// the mockup's `a8de42…c884`-style short id.
export function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function formatStarted(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hh}:${mm}`;
}

export function formatRelativeToNow(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}
