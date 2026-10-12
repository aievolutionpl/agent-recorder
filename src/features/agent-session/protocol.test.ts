import { describe, expect, it } from "vitest";
import { exportAgentEvents, importAgentEvents } from "./protocol";

describe("agent event protocol", () => {
	it("round-trips JSONL without changing event shape", () => {
		const events = [{ type: "note" as const, sessionId: "demo", timestamp: "2026-10-12T09:00:00.000Z", message: "hello" }];
		expect(importAgentEvents(exportAgentEvents(events))).toEqual(events);
	});
});
