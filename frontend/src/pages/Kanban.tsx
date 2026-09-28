import { useState } from "react";
import { useProjects, useTasks } from "../api/hooks";
import type { TaskCard as TaskCardData, TaskColumn } from "../api/types";
import { AppHeader, type AppTab } from "../components/AppHeader";
import { InstallScopeRow } from "../components/InstallScopeRow";
import { KanbanIcon } from "../components/icons";
import { PanelError } from "../components/PanelError";
import { StateCard } from "../components/StateCard";
import { TaskCard } from "../components/TaskCard";

interface KanbanProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const COLUMNS: { key: TaskColumn; title: string }[] = [
  { key: "ready", title: "Ready" },
  { key: "needs_attention", title: "Needs Attention" },
  { key: "ongoing", title: "Ongoing" },
  { key: "done", title: "Done" },
];

// pages/Kanban.tsx per `board-single-project.html`/`board-multi-project.
// html`/`board-empty.html`/`board-error.html` (PRD §6.1-§6.4) - fetches the
// flat `/api/tasks` list and groups it into 4 columns client-side, same
// division of labor as every other list-shaped page in this app. Reuses
// AppHeader/InstallScopeRow verbatim (§9's install-type-reuse note - no new
// UI for single- vs. multi-project); the pill/title/favicon/chime (§6.9)
// already live inside AppHeader itself, not duplicated here.
export function Kanban({ activeTab, onTabChange }: KanbanProps) {
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const projects = useProjects();
  const hostTag = projects.data?.hostname ?? "localhost";
  const multiProject = (projects.data?.projects.length ?? 0) > 1;
  const tasks = useTasks(projectFilter);

  const grouped: Record<TaskColumn, TaskCardData[]> = {
    ready: [],
    needs_attention: [],
    ongoing: [],
    done: [],
  };
  for (const t of tasks.data ?? []) grouped[t.column].push(t);

  return (
    <div className="shell">
      <AppHeader
        activeTab={activeTab}
        onTabChange={onTabChange}
        connected={!projects.isError}
        onRefresh={() => {
          projects.refetch();
          tasks.refetch();
        }}
      />

      <InstallScopeRow
        projects={projects.data?.projects ?? []}
        hostTag={hostTag}
        selectedProject={projectFilter}
        onSelectProject={setProjectFilter}
      />

      {tasks.isError ? (
        <div
          className="panel err"
          style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <PanelError
              message="Couldn't load task folders — GET /api/tasks failed"
              onRetry={() => tasks.refetch()}
              testId="kanban-error"
            />
          </div>
        </div>
      ) : tasks.isSuccess && tasks.data.length === 0 ? (
        <StateCard
          data-testid="kanban-empty"
          icon={<KanbanIcon />}
          title="No task folders yet"
          body={
            <>
              This project has no <code>docs/tasks/</code> folders — or only <code>_template/</code> — for cairn to
              show.
            </>
          }
        />
      ) : (
        <div className="kanban-columns">
          {COLUMNS.map((col) => (
            <div key={col.key}>
              <div className="kanban-column-head">
                <span className="kanban-column-title">{col.title}</span>
                <span className="kanban-column-count">{grouped[col.key].length}</span>
              </div>
              <div className="kanban-column-cards">
                {grouped[col.key].map((t) => (
                  <TaskCard key={`${t.project}::${t.folder}`} task={t} showProject={multiProject} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
