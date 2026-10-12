/**
 * Append-only JSONL session receiver.
 *
 * Each agent session gets its own `<sanitized-session-id>.jsonl` file. Writes
 * are serialized through a per-session promise chain so concurrent callers can
 * never interleave partial lines. This is Windows-safe: it only uses
 * `node:fs/promises` append, never file locks or unix signals.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type AppendableEvent = Record<string, unknown>;

export type AgentEventSessionStore = {
	/** Appends events to a session file, creating it if needed. */
	append: (sessionId: string, events: readonly AppendableEvent[]) => Promise<void>;
	/** Reads back all events for a session (empty array if none). */
	read: (sessionId: string) => Promise<AppendableEvent[]>;
	/** Resolves the on-disk path for a session id. */
	pathFor: (sessionId: string) => string;
	/** Flushes pending writes and releases resources. */
	close: () => Promise<void>;
};

/**
 * Converts an arbitrary session id into a filename-safe token. Prevents path
 * traversal and Windows-invalid characters.
 */
export function sanitizeSessionId(sessionId: string): string {
	const cleaned = sessionId
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/\.{2,}/g, "_")
		.replace(/^[._]+/, "_")
		.replace(/[._]+$/, "_");
	return cleaned.length > 0 ? cleaned.slice(0, 128) : "session";
}

export function createAgentEventSessionStore(options: { dir: string }): AgentEventSessionStore {
	const dir = options.dir;
	// Per-session serialization chain; never rejects so one failure cannot
	// poison subsequent appends.
	const chains = new Map<string, Promise<void>>();

	function pathFor(sessionId: string): string {
		return path.join(dir, `${sanitizeSessionId(sessionId)}.jsonl`);
	}

	async function writeEvents(sessionId: string, events: readonly AppendableEvent[]) {
		if (events.length === 0) return;
		await fs.mkdir(dir, { recursive: true });
		const payload = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
		await fs.appendFile(pathFor(sessionId), payload, "utf8");
	}

	return {
		append(sessionId, events) {
			const previous = chains.get(sessionId) ?? Promise.resolve();
			const next = previous
				.catch(() => undefined)
				.then(() => writeEvents(sessionId, events))
				.then(() => undefined)
				.catch(() => undefined);
			chains.set(sessionId, next);
			return next;
		},
		async read(sessionId) {
			try {
				const raw = await fs.readFile(pathFor(sessionId), "utf8");
				const lines = raw
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0);
				const events: AppendableEvent[] = [];
				for (const line of lines) {
					try {
						events.push(JSON.parse(line) as AppendableEvent);
					} catch {
						/* skip corrupt lines rather than failing the whole read */
					}
				}
				return events;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw error;
			}
		},
		pathFor,
		async close() {
			await Promise.allSettled([...chains.values()]);
			chains.clear();
		},
	};
}
