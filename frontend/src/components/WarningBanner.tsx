import type { UsageLimitEvent } from "../api/types";
import { AlertTriangleIcon } from "./icons";

interface WarningBannerProps {
  events: UsageLimitEvent[];
  onViewSession: (sessionId: string) => void;
}

// Kept from token-metering/frontend, restyled to this design system - no
// mockup shows it (none of the 10 states hit a usage-limit event) and
// DESIGN.md doesn't name it, but `/api/usage-limit-events` is unchanged v1
// API surface; dropping a working feature silently would be a bigger
// change than a mockup simply omitting an edge case (see PLAN.md's
// judgment call 2). Rendered only when the range's events are non-empty,
// same conditional-render behavior as before.
export function WarningBanner({ events, onViewSession }: WarningBannerProps) {
  if (events.length === 0) return null;

  const mostRecent = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  const plural = events.length === 1 ? "once" : `${events.length} times`;

  return (
    <div
      data-testid="usage-limit-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 18,
        padding: "10px 16px",
        borderRadius: 8,
        border: "1px solid var(--remove)",
        background: "var(--remove-bg)",
        color: "var(--remove)",
        fontSize: 13,
      }}
    >
      {/* size matches .err-text svg's 14px - PanelError's icon+text
          treatment for this same icon - since this banner has no
          wrapping class to constrain it the way PanelError's does. */}
      <AlertTriangleIcon size={14} />
      <span>
        Usage limit hit {plural} — session <span className="mono">{mostRecent.session_id}</span>
      </span>
      <button
        type="button"
        data-testid="usage-limit-view-session"
        onClick={() => onViewSession(mostRecent.session_id)}
        className="mono"
        style={{
          marginLeft: "auto",
          border: "none",
          background: "transparent",
          color: "var(--remove)",
          cursor: "pointer",
          fontSize: 12,
          borderBottom: "1px solid var(--remove)",
          padding: 0,
        }}
      >
        View session →
      </button>
    </div>
  );
}
