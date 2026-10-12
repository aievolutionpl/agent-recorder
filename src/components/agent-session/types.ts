export type SessionStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "paused"
  | "error"
  | "finished";

export type EntryKind =
  | "tool_call"
  | "result"
  | "browser_action"
  | "browser_click"
  | "navigation"
  | "screenshot"
  | "note"
  | "error"
  | "system"
  | "user_message"
  | "assistant_message";

export type PrivacyStatus = "public" | "private" | "redacted";

export interface TimelineEntry {
  id: string;
  kind: EntryKind;
  timestamp: number; // epoch ms
  title: string;
  detail?: string;
  provider?: string;
  toolName?: string;
  url?: string;
  durationMs?: number;
  status?: "success" | "failure" | "pending";
  privacy?: PrivacyStatus;
  metadata?: Record<string, unknown>;
}

export interface AgentSessionProps {
  /** Session identifier / label */
  sessionId?: string;
  /** Human-readable session title */
  title?: string;
  /** Current session status */
  status?: SessionStatus;
  /** Ordered timeline entries */
  entries?: TimelineEntry[];
  /** Elapsed time in ms; if omitted, computed from entries */
  elapsedMs?: number;
  /** Provider name shown in the badge, e.g. "OpenAI", "Anthropic" */
  provider?: string;
  /** Tool names currently available / active */
	tools?: string[];
	endpoint?: string;
  /** Whether the panel is collapsible */
  collapsible?: boolean;
  /** Privacy status shown in the header */
  privacy?: PrivacyStatus;
  /** Show/hide the filter bar */
  showFilters?: boolean;
  /** Called when the user toggles recording */
  onToggleRecording?: (nextStatus: SessionStatus) => void;
  /** Called when the user clears the timeline */
  onClear?: () => void;
  /** Called when a filter changes */
  onFilterChange?: (filters: EntryKind[]) => void;
  /** Additional className */
  className?: string;
}
