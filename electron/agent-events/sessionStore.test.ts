import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentEventSessionStore } from "./sessionStore";

describe("createAgentEventSessionStore", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-events-store-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("appends events as newline-delimited JSON, one line per event", async () => {
		const store = createAgentEventSessionStore({ dir: root });

		await store.append("sess-1", [
			{ type: "tool_call", sessionId: "sess-1", timestamp: "2026-10-12T09:00:00.000Z" },
			{ type: "tool_result", sessionId: "sess-1", timestamp: "2026-10-12T09:00:01.000Z" },
		]);
		await store.close();

		const raw = await fs.readFile(path.join(root, "sess-1.jsonl"), "utf8");
		const lines = raw.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0] as string).type).toBe("tool_call");
		expect(JSON.parse(lines[1] as string).type).toBe("tool_result");
	});

	it("appends across separate calls without truncating earlier events", async () => {
		const store = createAgentEventSessionStore({ dir: root });

		await store.append("sess-1", [{ type: "note", sessionId: "sess-1", timestamp: "t1" }]);
		await store.append("sess-1", [{ type: "note", sessionId: "sess-1", timestamp: "t2" }]);
		await store.close();

		const events = await store.read("sess-1");
		expect(events.map((event) => event.timestamp)).toEqual(["t1", "t2"]);
	});

	it("sanitizes identifiers to safe filenames", async () => {
		const store = createAgentEventSessionStore({ dir: root });
		await store.append("../../evil session", [
			{ type: "note", sessionId: "x", timestamp: "t" },
		]);
		await store.close();

		const entries = await fs.readdir(root);
		expect(entries).toHaveLength(1);
		expect(entries[0]).not.toContain("/");
		expect(entries[0]).not.toContain("..");
	});

	it("serializes concurrent appends so no line is interleaved", async () => {
		const store = createAgentEventSessionStore({ dir: root });
		const batch = Array.from({ length: 50 }, (_, index) => ({
			type: "note" as const,
			sessionId: "sess",
			timestamp: `t-${index}`,
			index,
		}));

		await Promise.all([store.append("sess", batch), store.append("sess", batch)]);
		await store.close();

		const raw = await fs.readFile(path.join(root, "sess.jsonl"), "utf8");
		const lines = raw.trim().split("\n");
		expect(lines).toHaveLength(100);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("returns an empty array when reading a session that does not exist", async () => {
		const store = createAgentEventSessionStore({ dir: root });
		expect(await store.read("missing")).toEqual([]);
		await store.close();
	});

	it("exposes the resolved path for a session", () => {
		const store = createAgentEventSessionStore({ dir: root });
		expect(store.pathFor("sess-1")).toBe(path.join(root, "sess-1.jsonl"));
	});
});
