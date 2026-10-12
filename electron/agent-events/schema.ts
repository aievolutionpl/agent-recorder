/**
 * Schema, validation, redaction and chain-of-thought stripping for AI agent
 * tool events ingested from external shell agents (Claude Code, Codex, ...).
 *
 * Design goals:
 *  - Accept a small, well-defined JSON shape; be forgiving about extra fields.
 *  - Never persist obvious secrets (tokens, passwords, API keys, cookies).
 *  - Never persist chain-of-thought / hidden-reasoning fields.
 *
 * This module is intentionally free of Electron imports so it can be unit
 * tested and reused from plain Node processes.
 */

export const AGENT_EVENT_TYPES = [
	"session_start",
	"session_end",
	"tool_call",
	"tool_result",
	"browser_action",
	"navigation",
	"screenshot",
	"file_action",
	"terminal_action",
	"note",
	"error",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

const AGENT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(AGENT_EVENT_TYPES);

export const REDACTED_PLACEHOLDER = "[REDACTED]";

/** Maximum serialized size of a single event, in bytes (UTF-8). */
export const MAX_EVENT_BYTES = 256 * 1024;

/**
 * Field names (matched case-insensitively, ignoring separators) whose values are
 * always replaced with {@link REDACTED_PLACEHOLDER}.
 */
const SECRET_KEY_PATTERNS: readonly string[] = [
	"password",
	"passwd",
	"passphrase",
	"secret",
	"token",
	"apikey",
	"api_key",
	"accesskey",
	"access_key",
	"privatekey",
	"private_key",
	"clientsecret",
	"client_secret",
	"authorization",
	"auth",
	"credential",
	"credentials",
	"cookie",
	"sessioncookie",
	"setcookie",
	"bearer",
	"refreshtoken",
	"idtoken",
	"accesstoken",
];

/**
 * Field names whose values are chain-of-thought / hidden reasoning and must be
 * dropped entirely before persistence. Prevents leaking internal model
 * reasoning into recorded sessions.
 */
const CHAIN_OF_THOUGHT_KEYS: readonly string[] = [
	"reasoning",
	"reasoningcontent",
	"reasoning_content",
	"chainofthought",
	"chain_of_thought",
	"chain-of-thought",
	"cot",
	"thinking",
	"thoughts",
	"scratchpad",
	"scratch_pad",
	"internalreasoning",
	"internal_reasoning",
	"analysisinner",
	"hiddenreasoning",
	"hidden_reasoning",
];

/** Substrings that make a *string value* look like a credential. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
	/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub tokens
	/\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style keys
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
	/\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

function normalizeKey(key: string): string {
	return key.toLowerCase().replace(/[\s_-]/g, "");
}

function isSecretKey(key: string): boolean {
	const normalized = normalizeKey(key);
	if (SECRET_KEY_PATTERNS.includes(normalized)) return true;
	return (
		normalized.includes("token") ||
		normalized.includes("secret") ||
		normalized.includes("password") ||
		normalized.includes("apikey") ||
		normalized.includes("privatekey")
	);
}

function isChainOfThoughtKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return CHAIN_OF_THOUGHT_KEYS.some((candidate) => normalizeKey(candidate) === normalized);
}

function redactString(value: string): string {
	let output = value;
	for (const pattern of SECRET_VALUE_PATTERNS) {
		output = output.replace(pattern, REDACTED_PLACEHOLDER);
	}
	return output;
}

export type SanitizeStats = {
	redactions: number;
	strippedCot: number;
};

/**
 * Recursively replaces secret-named fields with the redaction placeholder.
 * Returns a new structure; never mutates the input.
 */
export function redactSecrets(value: unknown, stats?: SanitizeStats): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => redactSecrets(item, stats));
	}
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			if (isSecretKey(key)) {
				output[key] = REDACTED_PLACEHOLDER;
				if (stats) stats.redactions += 1;
				continue;
			}
			output[key] = redactSecrets(child, stats);
		}
		return output;
	}
	if (typeof value === "string") {
		return redactString(value);
	}
	return value;
}

/**
 * Recursively drops chain-of-thought fields. Returns a new structure; never
 * mutates the input.
 */
export function stripChainOfThought(value: unknown, stats?: SanitizeStats): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stripChainOfThought(item, stats));
	}
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			if (isChainOfThoughtKey(key)) {
				if (stats) stats.strippedCot += 1;
				continue;
			}
			output[key] = stripChainOfThought(child, stats);
		}
		return output;
	}
	return value;
}

export type AgentEvent = {
	type: AgentEventType;
	sessionId: string;
	timestamp: string;
	source?: string;
	toolName?: string;
	input?: unknown;
	output?: unknown;
	url?: string;
	durationMs?: number;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ValidationFailure = { ok: false; error: string };
export type ValidationSuccess = { ok: true; event: AgentEvent };
export type ValidationResult = ValidationSuccess | ValidationFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value).toISOString();
	}
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}
	return null;
}

/**
 * Validates the raw event against the expected schema. Redaction and CoT
 * stripping happen separately in {@link sanitizeAgentEvent}.
 */
export function validateAgentEvent(raw: unknown): ValidationResult {
	if (!isPlainObject(raw)) {
		return { ok: false, error: "event must be a JSON object" };
	}

	const type = raw.type;
	if (typeof type !== "string" || type.trim().length === 0) {
		return { ok: false, error: "event.type is required" };
	}
	if (!AGENT_EVENT_TYPE_SET.has(type)) {
		return { ok: false, error: `unknown event.type: ${type}` };
	}

	const sessionId = raw.sessionId;
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		return { ok: false, error: "event.sessionId is required" };
	}

	const timestamp = normalizeTimestamp(raw.timestamp);
	if (!timestamp) {
		return { ok: false, error: "event.timestamp is required" };
	}

	return {
		ok: true,
		event: {
			...raw,
			type: type as AgentEventType,
			sessionId,
			timestamp,
		} as AgentEvent,
	};
}

/**
 * Normalizes a raw event (timestamp coercion, field preservation). Throws if
 * the raw value is not object-shaped so callers cannot silently persist junk.
 */
export function normalizeAgentEvent(raw: unknown): AgentEvent {
	const result = validateAgentEvent(raw);
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.event;
}

export type SanitizedEvent = SanitizeStats & {
	event: AgentEvent;
};

/**
 * Applies redaction and chain-of-thought stripping to a raw event and returns
 * the sanitized event plus counters. The input is never mutated.
 */
export function sanitizeAgentEvent(raw: unknown): SanitizedEvent {
	const stats: SanitizeStats = { redactions: 0, strippedCot: 0 };
	const withoutCot = stripChainOfThought(raw, stats) as Record<string, unknown>;
	const redacted = redactSecrets(withoutCot, stats) as Record<string, unknown>;
	return {
		event: redacted as AgentEvent,
		...stats,
	};
}

/** Serialized byte length of an event, used for size-limit enforcement. */
export function eventByteLength(event: unknown): number {
	return Buffer.byteLength(JSON.stringify(event), "utf8");
}
