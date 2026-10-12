import { useMemo, useState } from "react";
import type { AgentSessionProps, EntryKind, SessionStatus, TimelineEntry } from "./types";
import "./agent-session.css";

const filters: Array<{ kind: EntryKind; label: string }> = [
	{ kind: "tool_call", label: "Tool call" }, { kind: "result", label: "Result" }, { kind: "browser_action", label: "Browser" }, { kind: "navigation", label: "Navigation" }, { kind: "screenshot", label: "Screenshots" }, { kind: "note", label: "Notes" }, { kind: "error", label: "Failures" },
];
function formatElapsed(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
function formatTime(timestamp: number): string { return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

export function AgentSession({ sessionId = "live", title = "Agent Session", status = "idle", entries = [], elapsedMs, provider = "Local agent", tools = [], endpoint, privacy = "redacted", showFilters = true, onToggleRecording, onClear, className = "" }: AgentSessionProps) {
	const [activeFilter, setActiveFilter] = useState<EntryKind | null>(null);
	const visibleEntries = useMemo(() => activeFilter ? entries.filter((entry) => entry.kind === activeFilter) : entries, [activeFilter, entries]);
	const computedElapsed = elapsedMs ?? (entries.length > 0 ? Math.max(0, (entries.length > 1 ? entries[entries.length - 1]!.timestamp : Date.now()) - entries[0]!.timestamp) : 0);
	const isRecording = status === "recording";
	const statusLabel: Record<SessionStatus, string> = { idle: "Ready", connecting: "Connecting", recording: "Recording", paused: "Paused", error: "Error", finished: "Finished" };
	return <section className={`agent-session ${className}`} aria-label="Agent Session">
		<header className="agent-session__header"><div><h2 className="agent-session__title">{title}</h2><p className="agent-session__subline">{sessionId} · <span>{formatElapsed(computedElapsed)}</span></p></div><div className="agent-session__badges"><span className="agent-session__badge">{provider}</span><span className={`agent-session__badge ${isRecording ? "agent-session__badge--recording" : "agent-session__badge--live"}`}>{statusLabel[status]}</span><span className="agent-session__badge agent-session__badge--privacy">{privacy === "redacted" ? "Redacted" : privacy}</span></div></header>
		<div className="agent-session__body"><div className="agent-session__toolbar">{showFilters && <div className="agent-session__filters" aria-label="Event filters"><button className="agent-session__filter" aria-pressed={activeFilter === null} onClick={() => setActiveFilter(null)}>All</button>{filters.map((filter) => <button key={filter.kind} className="agent-session__filter" aria-pressed={activeFilter === filter.kind} onClick={() => setActiveFilter(filter.kind)}>{filter.label}</button>)}</div>}<div className="agent-session__tools"><span className="agent-session__meta">{entries.length} events</span>{onToggleRecording && <button className="agent-session__action" onClick={() => onToggleRecording(isRecording ? "paused" : "recording")}>{isRecording ? "Pause" : "Record"}</button>}{onClear && <button className="agent-session__filter" onClick={onClear}>Clear</button>}</div></div>
			<div className="agent-session__timeline">{visibleEntries.length === 0 ? <div className="agent-session__empty">No events yet. Send a JSON event to the local receiver to see it here.</div> : visibleEntries.map((entry) => <TimelineRow key={entry.id} entry={entry} />)}</div>{endpoint && <p className="agent-session__endpoint">POST {endpoint}/events</p>}{tools.length > 0 && entries.length === 0 && <div className="agent-session__tools">{tools.map((tool) => <span className="agent-session__badge" key={tool}>{tool}</span>)}</div>}</div>
	</section>;
}
function TimelineRow({ entry }: { entry: TimelineEntry }) { return <article className="agent-session__entry"><span className={`agent-session__dot agent-session__dot--${entry.status ?? "success"}`} aria-hidden="true" /><div><div className="agent-session__entry-title">{entry.title}</div>{entry.detail && <div className="agent-session__detail" title={entry.detail}>{entry.detail}</div>}{entry.url && <div className="agent-session__detail">{entry.url}</div>}</div><div className="agent-session__meta">{entry.durationMs ? `${entry.durationMs}ms · ` : ""}{formatTime(entry.timestamp)}</div></article>; }
