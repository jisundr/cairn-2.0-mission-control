import type { ReactNode } from "react";
import { cn } from "../lib/utils";

// `.stat`/`.stat-label`/`.stat-value` per overview-loaded.html. `faint`
// renders the smaller, `--ink-faint` treatment overview-loaded.html uses
// for an unresolvable ("unknown*") value.
interface StatCardProps {
  label: string;
  value: string;
  faint?: boolean;
  infoDot?: ReactNode;
  "data-testid"?: string;
}

export function StatCard({ label, value, faint, infoDot, "data-testid": testId }: StatCardProps) {
  return (
    <div className="stat" data-testid={testId}>
      <div className="stat-label">
        {label}
        {infoDot}
      </div>
      <div className={cn("stat-value mono", faint && "faint")}>{value}</div>
    </div>
  );
}
