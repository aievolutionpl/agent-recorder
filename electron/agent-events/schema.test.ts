import { describe, expect, it } from "vitest";

import {
	AGENT_EVENT_TYPES,
	REDACTED_PLACEHOLDER,
	normalizeAgentEvent,
	redactSecrets,
	sanitizeAgentEvent,
	stripChainOfThought,
	validateAgentEvent,
} from "./schema";

describe("validateAgentEvent", () => {
	it("accepts a minimal valid tool_call event", () => {
		const result = validateAgentEvent({
			type: "tool_call",
			sessionId: "sess-1",
			timestamp: "2026-10-12T09:00:00.000Z",
			source: "claude-code",
			toolName: "read_file",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.event.type).toBe("tool_call");
			expect(result.event.sessionId).toBe("sess-1");
			expect(result.event.toolName).toBe("read_file");
		}
	});

	it("rejects non-object payloads", () => {
		expect(validateAgentEvent(null).ok).toBe(false);
		expect(validateAgentEvent("nope").ok).toBe(false);
		expect(validateAgentEvent(42).ok).toBe(false);
		expect(validateAgentEvent([]).ok).toBe(false);
	});

	it("rejects a missing or empty type", () => {
		const result = validateAgentEvent({ sessionId: "s", timestamp: "t" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/type/i);
	});

	it("rejects an unknown type", () => {
		const result = validateAgentEvent({
			type: "definitely_not_real",
			sessionId: "s",
			timestamp: "2026-10-12T09:00:00.000Z",
		});
		expect(result.ok).toBe(false);
	});

	it("rejects missing sessionId", () => {
		const result = validateAgentEvent({
			type: "tool_call",
			timestamp: "2026-10-12T09:00:00.000Z",
		});
		expect(result.ok).toBe(false);
	});

	it("rejects missing timestamp", () => {
		const result = validateAgentEvent({ type: "tool_call", sessionId: "s" });
		expect(result.ok).toBe(false);
	});

	it("exposes the supported type list", () => {
		expect(AGENT_EVENT_TYPES).toContain("tool_call");
		expect(AGENT_EVENT_TYPES).toContain("tool_result");
		expect(AGENT_EVENT_TYPES).toContain("browser_action");
		expect(AGENT_EVENT_TYPES).toContain("session_start");
		expect(AGENT_EVENT_TYPES).toContain("session_end");
		expect(AGENT_EVENT_TYPES).toContain("note");
	});
});

describe("normalizeAgentEvent", () => {
	it("converts epoch-millisecond timestamps to ISO strings", () => {
		const event = normalizeAgentEvent({
			type: "tool_result",
			sessionId: "s",
			timestamp: 1_700_000_000_000,
		});
		expect(event.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
	});

	it("preserves unknown extra fields", () => {
		const event = normalizeAgentEvent({
			type: "note",
			sessionId: "s",
			timestamp: "2026-10-12T09:00:00.000Z",
			customField: "kept",
		});
		expect((event as Record<string, unknown>).customField).toBe("kept");
	});
});

describe("redactSecrets", () => {
	it("redacts secret-named fields at the top level", () => {
		const out = redactSecrets({
			apiKey: "sk-abc",
			password: "hunter2",
			toolName: "read_file",
		}) as Record<string, unknown>;

		expect(out.apiKey).toBe(REDACTED_PLACEHOLDER);
		expect(out.password).toBe(REDACTED_PLACEHOLDER);
		expect(out.toolName).toBe("read_file");
	});

	it("redacts secret fields nested inside objects and arrays", () => {
		const out = redactSecrets({
			input: {
				headers: { Authorization: "Bearer xyz", "x-request-id": "abc" },
				items: [{ secretToken: "t", keep: "v" }],
			},
		}) as { input: { headers: Record<string, unknown>; items: Array<Record<string, unknown>> } };

		expect(out.input.headers.Authorization).toBe(REDACTED_PLACEHOLDER);
		expect(out.input.headers["x-request-id"]).toBe("abc");
		expect(out.input.items[0]?.secretToken).toBe(REDACTED_PLACEHOLDER);
		expect(out.input.items[0]?.keep).toBe("v");
	});

	it("redacts values that look like known key prefixes", () => {
		const out = redactSecrets({
			note: "token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa here",
		}) as { note: string };
		expect(out.note).not.toContain("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		expect(out.note).toContain(REDACTED_PLACEHOLDER);
	});

	it("does not mutate the input object", () => {
		const input = { password: "secret", keep: 1 };
		redactSecrets(input);
		expect(input.password).toBe("secret");
	});
});

describe("stripChainOfThought", () => {
	it("removes chain-of-thought keys recursively", () => {
		const out = stripChainOfThought({
			toolName: "x",
			reasoning: "because I thought hard",
			nested: { chain_of_thought: "step 1", thinking: "hmm", keep: "v" },
		}) as Record<string, unknown>;

		expect(out.reasoning).toBeUndefined();
		expect((out.nested as Record<string, unknown>).chain_of_thought).toBeUndefined();
		expect((out.nested as Record<string, unknown>).thinking).toBeUndefined();
		expect((out.nested as Record<string, unknown>).keep).toBe("v");
	});

	it("strips reasoningContent (DeepSeek style) inside arrays", () => {
		const out = stripChainOfThought({
			items: [{ reasoningContent: "internal", keep: 1 }],
		}) as { items: Array<Record<string, unknown>> };
		expect(out.items[0]?.reasoningContent).toBeUndefined();
		expect(out.items[0]?.keep).toBe(1);
	});
});

describe("sanitizeAgentEvent", () => {
	it("returns the sanitized event plus redaction and CoT counters", () => {
		const result = sanitizeAgentEvent({
			type: "tool_call",
			sessionId: "s",
			timestamp: "2026-10-12T09:00:00.000Z",
			input: { token: "abc", keep: "x" },
			reasoning: "internal",
		});

		expect(result.event.input).toEqual({ token: REDACTED_PLACEHOLDER, keep: "x" });
		expect(result.event.reasoning).toBeUndefined();
		expect(result.redactions).toBeGreaterThanOrEqual(1);
		expect(result.strippedCot).toBeGreaterThanOrEqual(1);
	});
});
