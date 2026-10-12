import { useCallback, useEffect, useMemo, useState } from "react";
import type { TimelineEntry } from "../../components/agent-session/types";
import type { AgentEventRecord, AgentEventReceiverStatus, AgentSessionEventType } from "./protocol";

function toTimelineEntry(event: AgentEventRecord, index: number): TimelineEntry | null {
	const visibleTypes: AgentSessionEventType[] = ["tool_call", "tool_result", "browser_action", "navigation", "screenshot", "note", "error"];
	if (!visibleTypes.includes(event.type as AgentSessionEventType)) return null;
	const timestamp = Date.parse(event.timestamp);
	return { id: `${event.sessionId}-${event.timestamp}-${index}`, kind: (event.type === "tool_result" ? "result" : event.type) as TimelineEntry["kind"], timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp, title: event.toolName ?? event.message ?? event.type.replace(/_/g, " "), detail: typeof event.output === "string" ? event.output : typeof event.input === "string" ? event.input : event.url, provider: event.provider ?? event.source, toolName: event.toolName, url: event.url, durationMs: event.durationMs, status: event.status === "failure" || event.type === "error" ? "failure" : event.status === "pending" ? "pending" : "success", privacy: "redacted" };
}

export function useAgentSession(sessionId = "live") {
	const [status, setStatus] = useState<AgentEventReceiverStatus | null>(null);
	const [events, setEvents] = useState<AgentEventRecord[]>([]);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		if (!window.electronAPI?.getAgentEventStatus) return;
		try { setStatus(await window.electronAPI.getAgentEventStatus()); setEvents((await window.electronAPI.readAgentEvents(sessionId)) as AgentEventRecord[]); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read agent events"); }
	}, [sessionId]);
	useEffect(() => { void refresh(); return window.electronAPI?.onAgentEvent?.((event) => { if (event.sessionId === sessionId) setEvents((current) => [...current, event]); }); }, [refresh, sessionId]);
	const entries = useMemo(() => events.map(toTimelineEntry).filter((entry): entry is TimelineEntry => entry !== null), [events]);
	const elapsedMs = entries.length > 1 ? Math.max(0, entries[entries.length - 1]!.timestamp - entries[0]!.timestamp) : 0;
	return { status, events, entries, elapsedMs, error, refresh };
}
