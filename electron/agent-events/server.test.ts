import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REDACTED_PLACEHOLDER } from "./schema";
import { createAgentEventIngestionServer } from "./server";
import { createAgentEventSessionStore } from "./sessionStore";

type Started = {
	url: string;
	port: number;
	stop: () => Promise<void>;
	store: ReturnType<typeof createAgentEventSessionStore>;
};

describe("createAgentEventIngestionServer", () => {
	let root: string;
	let started: Started | null = null;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-events-server-"));
	});

	afterEach(async () => {
		if (started) await started.stop();
		started = null;
		await fs.rm(root, { recursive: true, force: true });
	});

	async function start(
		options: Partial<Parameters<typeof createAgentEventIngestionServer>[0]> = {},
	): Promise<Started> {
		const store = createAgentEventSessionStore({ dir: root });
		const server = createAgentEventIngestionServer({ store, port: 0, ...options });
		await server.start();
		const address = server.address() as AddressInfo;
		started = {
			url: `http://127.0.0.1:${address.port}`,
			port: address.port,
			stop: async () => {
				await server.stop();
				await store.close();
			},
			store,
		};
		return started;
	}

	it("binds to loopback only and reports its address", async () => {
		const s = await start();
		const address = (s.port, s.url);
		expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(address).toBeTruthy();
	});

	it("accepts a single JSON event over POST /events and persists it", async () => {
		const s = await start();

		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: "tool_call",
				sessionId: "sess-1",
				timestamp: "2026-10-12T09:00:00.000Z",
				toolName: "read_file",
			}),
		});

		expect(response.status).toBe(202);
		const body = (await response.json()) as { accepted: number; rejected: number };
		expect(body.accepted).toBe(1);
		expect(body.rejected).toBe(0);

		const events = await s.store.read("sess-1");
		expect(events).toHaveLength(1);
		expect((events[0] as Record<string, unknown>).toolName).toBe("read_file");
	});

	it("accepts a JSONL batch over POST /events", async () => {
		const s = await start();
		const ndjson = [
			JSON.stringify({ type: "note", sessionId: "s2", timestamp: "t1" }),
			JSON.stringify({ type: "note", sessionId: "s2", timestamp: "t2" }),
			"",
		].join("\n");

		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/x-ndjson" },
			body: ndjson,
		});

		expect(response.status).toBe(202);
		const body = (await response.json()) as { accepted: number };
		expect(body.accepted).toBe(2);
		expect(await s.store.read("s2")).toHaveLength(2);
	});

	it("redacts secrets and strips chain-of-thought before persisting", async () => {
		const s = await start();

		await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: "tool_call",
				sessionId: "sess-secret",
				timestamp: "2026-10-12T09:00:00.000Z",
				input: { token: "abc123", keep: "value" },
				reasoning: "my private thoughts",
			}),
		});

		const events = await s.store.read("sess-secret");
		const event = events[0] as Record<string, unknown>;
		expect((event.input as Record<string, unknown>).token).toBe(REDACTED_PLACEHOLDER);
		expect((event.input as Record<string, unknown>).keep).toBe("value");
		expect(event.reasoning).toBeUndefined();
	});

	it("rejects malformed JSON with a 400", async () => {
		const s = await start();
		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{ this is not json",
		});
		expect(response.status).toBe(400);
	});

	it("rejects events that fail schema validation with a 422 by default", async () => {
		const s = await start();
		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "tool_call" }),
		});
		expect(response.status).toBe(422);
	});

	it("enforces the payload size limit", async () => {
		const s = await start({ maxBodyBytes: 256 });
		const big = JSON.stringify({
			type: "note",
			sessionId: "s",
			timestamp: "t",
			pad: "x".repeat(1000),
		});

		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: big,
		});

		expect(response.status).toBe(413);
	});

	it("replies to GET /health with ok and the bound port", async () => {
		const s = await start();
		const response = await fetch(`${s.url}/health`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; port: number };
		expect(body.ok).toBe(true);
		expect(body.port).toBe(s.port);
	});

	it("returns 404 for unknown routes and 405 for wrong methods", async () => {
		const s = await start();
		const notFound = await fetch(`${s.url}/nope`);
		expect(notFound.status).toBe(404);

		const wrongMethod = await fetch(`${s.url}/events`);
		expect(wrongMethod.status).toBe(405);
	});

	it("requires a bearer token when one is configured", async () => {
		const s = await start({ token: "shhh" });

		const unauthorized = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "note", sessionId: "s", timestamp: "t" }),
		});
		expect(unauthorized.status).toBe(401);

		const authorized = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: "Bearer shhh" },
			body: JSON.stringify({ type: "note", sessionId: "s", timestamp: "t" }),
		});
		expect(authorized.status).toBe(202);
	});

	it("allows opting into lenient mode to drop invalid events instead of failing", async () => {
		const s = await start({ strict: false });
		const response = await fetch(`${s.url}/events`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "note", sessionId: "s", timestamp: "t", bogus: true }),
		});

		expect(response.status).toBe(202);
		expect(await s.store.read("s")).toHaveLength(1);
	});
});
