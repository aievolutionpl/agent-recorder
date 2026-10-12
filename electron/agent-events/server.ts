/**
 * Loopback HTTP ingestion server for AI agent tool events.
 *
 * Security posture:
 *  - Binds to 127.0.0.1 by default (never 0.0.0.0) so events stay local-first.
 *  - Optionally requires a bearer token.
 *  - Hard payload size cap, enforced while streaming the body.
 *  - Rejects non-loopback remote addresses as defence in depth.
 *  - Every accepted event is redacted and has chain-of-thought stripped before
 *    it reaches the session store.
 *
 * Uses only Node built-ins (`node:http`), so it works identically on Windows,
 * macOS and Linux without native dependencies.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
	type AgentEventSessionStore,
	type AppendableEvent,
} from "./sessionStore";
import {
	eventByteLength,
	MAX_EVENT_BYTES,
	sanitizeAgentEvent,
	validateAgentEvent,
} from "./schema";

export const DEFAULT_INGESTION_HOST = "127.0.0.1";
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB per request

export type AgentEventIngestionServerOptions = {
	store: AgentEventSessionStore;
	/** Bind host. Defaults to 127.0.0.1. Pass 0.0.0.0 only if you truly need it. */
	host?: string;
	/** Port. 0 (default) lets the OS pick a free port. */
	port?: number;
	/** Maximum request body size in bytes. Defaults to 1 MiB. */
	maxBodyBytes?: number;
	/** Optional shared secret. When set, requests must send `Authorization: Bearer <token>`. */
	token?: string;
	/**
	 * When true (default) a request containing any invalid event is rejected
	 * with 422 and nothing is persisted. When false, invalid events are dropped
	 * and the rest are accepted.
	 */
	strict?: boolean;
	/** Optional logger for diagnostic warnings. Defaults to silent. */
	logger?: (message: string) => void;
	onEvents?: (events: readonly AppendableEvent[]) => void;
};

export type AgentEventIngestionServer = {
	start: () => Promise<AddressInfo>;
	stop: () => Promise<void>;
	address: () => AddressInfo | null;
	url: () => string | null;
};

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** True for IPv4/IPv6 loopback literals only. */
export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	return LOOPBACK_ADDRESSES.has(address);
}

function isNdjson(contentType: string | undefined): boolean {
	if (!contentType) return false;
	const lowered = contentType.toLowerCase();
	return (
		lowered.includes("application/x-ndjson") ||
		lowered.includes("application/ndjson") ||
		lowered.includes("text/plain")
	);
}

/** Parses a request body into an array of candidate event objects. */
export function parseEventPayload(body: string, ndjson: boolean): unknown[] {
	if (ndjson) {
		return body
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as unknown);
	}
	const parsed = JSON.parse(body) as unknown;
	return Array.isArray(parsed) ? parsed : [parsed];
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	const text = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(text),
	});
	res.end(text);
}

export function createAgentEventIngestionServer(
	options: AgentEventIngestionServerOptions,
): AgentEventIngestionServer {
	const host = options.host ?? DEFAULT_INGESTION_HOST;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	const strict = options.strict ?? true;
	const logger = options.logger ?? (() => undefined);
	const token = options.token;

	let server: Server | null = null;

	async function readBody(req: IncomingMessage): Promise<
		{ ok: true; body: string } | { ok: false; status: number; error: string }
	> {
		return new Promise((resolve) => {
			const chunks: Buffer[] = [];
			let total = 0;
			let settled = false;

			const finish = (result: { ok: true; body: string } | { ok: false; status: number; error: string }) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};

			req.on("data", (chunk: Buffer) => {
				if (settled) return; // over limit: keep draining but discard
				total += chunk.length;
				if (total > maxBodyBytes) {
					// Resolve immediately with 413 but do NOT destroy the socket:
					// destroying it before the response can be written makes
					// clients (and fetch) report a connection reset.
					finish({ ok: false, status: 413, error: "payload too large" });
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => {
				finish({ ok: true, body: Buffer.concat(chunks).toString("utf8") });
			});
			req.on("error", () => {
				finish({ ok: false, status: 400, error: "request stream error" });
			});
		});
	}

	async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (token) {
			const header = req.headers.authorization;
			if (header !== `Bearer ${token}`) {
				sendJson(res, 401, { error: "unauthorized" });
				return;
			}
		}

		const bodyResult = await readBody(req);
		if (!bodyResult.ok) {
			sendJson(res, bodyResult.status, { error: bodyResult.error });
			return;
		}

		const ndjson = isNdjson(req.headers["content-type"]);
		let candidates: unknown[];
		try {
			candidates = parseEventPayload(bodyResult.body, ndjson);
		} catch (error) {
			sendJson(res, 400, { error: `invalid JSON: ${(error as Error).message}` });
			return;
		}

		if (candidates.length === 0) {
			sendJson(res, 202, { accepted: 0, rejected: 0, redactions: 0, strippedCot: 0 });
			return;
		}

		const accepted: AppendableEvent[] = [];
		let rejected = 0;
		let redactions = 0;
		let strippedCot = 0;
		const perSession = new Map<string, AppendableEvent[]>();

		for (const candidate of candidates) {
			const validation = validateAgentEvent(candidate);
			if (!validation.ok) {
				if (strict) {
					sendJson(res, 422, { error: validation.error, accepted: 0, rejected: 1 });
					return;
				}
				rejected += 1;
				continue;
			}

			const sanitized = sanitizeAgentEvent(validation.event);
			if (eventByteLength(sanitized.event) > MAX_EVENT_BYTES) {
				if (strict) {
					sendJson(res, 422, { error: "event exceeds maximum size", accepted: 0, rejected: 1 });
					return;
				}
				rejected += 1;
				continue;
			}

			redactions += sanitized.redactions;
			strippedCot += sanitized.strippedCot;
			const event = sanitized.event as unknown as AppendableEvent;
			accepted.push(event);
			const sessionId = String(event.sessionId);
			const bucket = perSession.get(sessionId) ?? [];
			bucket.push(event);
			perSession.set(sessionId, bucket);
		}

		for (const [sessionId, events] of perSession) {
			await options.store.append(sessionId, events);
		}
		options.onEvents?.(accepted);

		sendJson(res, 202, {
			accepted: accepted.length,
			rejected,
			redactions,
			strippedCot,
		});
	}

	function route(req: IncomingMessage, res: ServerResponse): void {
		// Defence in depth: refuse anything that is not actually loopback.
		if (!isLoopbackAddress(req.socket.remoteAddress)) {
			logger(`refused non-loopback connection from ${req.socket.remoteAddress ?? "unknown"}`);
			sendJson(res, 403, { error: "loopback only" });
			return;
		}

		const method = req.method ?? "GET";
		const url = new URL(req.url ?? "/", `http://${host}`);
		const pathname = url.pathname;

		if (pathname === "/health") {
			if (method !== "GET") {
				sendJson(res, 405, { error: "method not allowed" });
				return;
			}
			const address = server?.address();
			sendJson(res, 200, {
				ok: true,
				port: typeof address === "object" && address ? address.port : null,
			});
			return;
		}

		if (pathname === "/events") {
			if (method !== "POST") {
				sendJson(res, 405, { error: "method not allowed" });
				return;
			}
			void handleEvents(req, res).catch((error) => {
				logger(`event handling failed: ${(error as Error).message}`);
				if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
			});
			return;
		}

		sendJson(res, 404, { error: "not found" });
	}

	return {
		start() {
			return new Promise<AddressInfo>((resolve, reject) => {
				const created = createServer((req, res) => route(req, res));
				created.once("error", reject);
				created.listen(options.port ?? 0, host, () => {
					created.removeListener("error", reject);
					server = created;
					resolve(created.address() as AddressInfo);
				});
			});
		},
		stop() {
			return new Promise<void>((resolve, reject) => {
				if (!server) {
					resolve();
					return;
				}
				const active = server;
				server = null;
				active.close((error) => (error ? reject(error) : resolve()));
				active.closeAllConnections?.();
			});
		},
		address() {
			const address = server?.address();
			return address && typeof address === "object" ? (address as AddressInfo) : null;
		},
		url() {
			const address = this.address();
			return address ? `http://${host}:${address.port}` : null;
		},
	};
}
