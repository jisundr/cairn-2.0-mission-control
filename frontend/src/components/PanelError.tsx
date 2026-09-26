// `.err-text` + `.btn-err` per overview-error.html/sessions-list-error.html/
// drilldown-error.html - goal 2's per-component error state. Each screen
// wraps these two pieces in its own layout (`.err-inline` for a panel-sized
// error, a centered flex column for a full-page error, a horizontal banner
// for Drilldown's page-level partial-failure notice), so this component
// renders only the pieces themselves, not a fixed wrapper.
interface PanelErrorProps {
  message: string;
  onRetry: () => void;
  testId?: string;
}

export function PanelError({ message, onRetry, testId }: PanelErrorProps) {
  return (
    <>
      <span className="err-text" data-testid={testId ? `${testId}-text` : undefined}>
        <AlertIcon />
        {message}
      </span>
      <button className="btn-err" onClick={onRetry} data-testid={testId ? `${testId}-retry` : "panel-error-retry"}>
        Retry
      </button>
    </>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
