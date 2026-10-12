import type { AgentEventType } from "../../../electron/agent-events/schema";

export type AgentSessionEventType = Extract<AgentEventType, "tool_call" | "tool_result" | "browser_action" | "navigation" | "screenshot" | "note" | "error">;
export type AgentEventRecord = {
	type: AgentEventType;
	sessionId: string;
	timestamp: string;
	source?: string;
	provider?: string;
	toolName?: string;
	status?: "success" | "failure" | "pending" | string;
	durationMs?: number;
	url?: string;
	message?: string;
	[key: string]: unknown;
};
export type AgentEventReceiverStatus = { running: boolean; url: string | null; port: number | null; tokenConfigured: boolean; storagePath: string | null };
export type AgentEventSubscription = (event: AgentEventRecord) => void;
export function exportAgentEvents(events: readonly AgentEventRecord[]): string { return events.map((event) => JSON.stringify(event)).join("\n"); }
export function importAgentEvents(input: string): AgentEventRecord[] { return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as AgentEventRecord); }
export function eventTypeLabel(type: AgentEventType): string { return type.replace(/_/g, " "); }
