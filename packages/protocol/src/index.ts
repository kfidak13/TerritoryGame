import type { GameConfig, Turn } from "@borderfall/engine";
import { z } from "zod";

export const MAX_NAME_LENGTH = 20;
export const DEFAULT_GAME_ID = "main";
/** Clients report their state hash every N ticks so the server can detect desyncs. */
export const HASH_INTERVAL_TICKS = 50;

export const GameIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

/** Intents as sent by a client; the server adds the clientId before relaying. */
export const ClientIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spawn"), tile: z.number().int().nonnegative() }),
]);
export type ClientIntent = z.infer<typeof ClientIntentSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    gameId: GameIdSchema,
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    /** Secret token from a previous welcome, used to reclaim the same player on reconnect. */
    token: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal("intent"), intent: ClientIntentSchema }),
  z.object({
    type: z.literal("hash"),
    tick: z.number().int().nonnegative(),
    hash: z.number().int().nonnegative(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | {
      type: "welcome";
      clientId: string;
      token: string;
      config: GameConfig;
      /** Number of turns already broadcast; the client must execute ticks 0..tick-1. */
      tick: number;
      /** Past turns that contained intents (empty turns are omitted). */
      turns: Turn[];
    }
  | { type: "turn"; turn: Turn }
  | { type: "desync"; tick: number }
  | { type: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = ClientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
