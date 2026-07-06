import { ErrorCodes } from '../types/ErrorCodes';

// A message payload carried by bot.send and delivered to Event.RECEIVED. Only
// JSON primitives, arrays, and plain objects of the same — which is exactly what
// survives a JSON round-trip.
export type JsonValue =
  number | string | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Max length of the JSON-encoded message (in characters). A broadcast is
// re-serialized to every other bot in the arena, so this bounds the amplified
// work as well as any single payload.
export const MAX_MESSAGE_CHARS = 4096;
// Max nesting depth, so validating (and re-serializing per receiver) a hostile
// deeply-nested payload can't blow the stack.
export const MAX_MESSAGE_DEPTH = 8;

const checkDepth = (value: unknown, depth: number): void => {
  if (depth > MAX_MESSAGE_DEPTH) {
    throw new Error(
      `${ErrorCodes.E023}: message nested too deeply (max ${MAX_MESSAGE_DEPTH})`
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) checkDepth(item, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      checkDepth((value as Record<string, unknown>)[key], depth + 1);
    }
  }
};

// Parse and validate a bot.send payload that arrives from the isolate as a JSON
// string (see compiler.ts: the bot-side wrapper does JSON.stringify, so the value
// crosses the sandbox boundary as text). JSON is the whitelist — functions, class
// instances, Dates, Maps/Sets, symbols, and host references simply cannot survive
// JSON.stringify, so only primitives, arrays, and plain objects can reach here.
// We add a size and depth cap on top. Throws E023 on anything invalid, which the
// bot's send() call surfaces (matching the old numeric-only send's throw).
export const parseMessage = (raw: unknown): JsonValue => {
  if (typeof raw !== 'string') {
    // JSON.stringify(undefined | function | symbol) yields undefined, so a
    // non-serializable value never crosses as a string.
    throw new Error(
      `${ErrorCodes.E023}: message could not be serialized (only JSON data can be sent)`
    );
  }
  if (raw.length > MAX_MESSAGE_CHARS) {
    throw new Error(
      `${ErrorCodes.E023}: message too large (max ${MAX_MESSAGE_CHARS} characters)`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${ErrorCodes.E023}: message is not valid JSON`);
  }
  checkDepth(value, 1);
  return value as JsonValue;
};
