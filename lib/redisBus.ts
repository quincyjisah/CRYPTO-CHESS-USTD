import Redis from "ioredis";

export const REDIS_KEYS = {
  game: (gameId: string) => `game:${gameId}`,
  ledger: (gameId: string) => `ledger:${gameId}`,
  gameStream: (gameId: string) => `stream:game:${gameId}`,
  matchmakingQueue: "queue:matchmaking",
  userRate: (userId: string) => `rate:user:${userId}`,
  userFunds: (userId: string, symbol: string) => `funds:${symbol}:${userId}`,
  escrow: (gameId: string) => `escrow:${gameId}`,
  txLog: "economy:txlog",
  suspiciousUser: (userId: string) => `oracle:suspicious:${userId}`,
};

export interface GameEvent<TPayload = unknown> {
  type: string;
  gameId: string;
  payload: TPayload;
  timestamp: number;
}

export interface RedisBusOptions {
  url?: string;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
}

let commandClient: Redis | undefined;
let publisherClient: Redis | undefined;
let subscriberClient: Redis | undefined;

export function createRedisClient(options: RedisBusOptions = {}): Redis {
  return new Redis(
    options.url ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    {
      keyPrefix: options.keyPrefix,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
      enableReadyCheck: true,
      lazyConnect: true,
    },
  );
}

export function getRedis(): Redis {
  commandClient ??= createRedisClient();
  return commandClient;
}

export function getPublisher(): Redis {
  publisherClient ??= createRedisClient();
  return publisherClient;
}

export function getSubscriber(): Redis {
  subscriberClient ??= createRedisClient();
  return subscriberClient;
}

export async function publishGameEvent<TPayload>(
  redis: Redis,
  event: GameEvent<TPayload>,
  maxStreamLength = 1_000,
): Promise<string> {
  const serialized = JSON.stringify(event);
  const streamId = await redis.xadd(
    REDIS_KEYS.gameStream(event.gameId),
    "MAXLEN",
    "~",
    maxStreamLength,
    "*",
    "event",
    serialized,
  );
  await redis.publish(REDIS_KEYS.gameStream(event.gameId), serialized);
  if (!streamId) {
    throw new Error(
      "Redis did not return a stream id for game event publication.",
    );
  }
  return streamId;
}

export async function subscribeToGame(
  redis: Redis,
  gameId: string,
  onEvent: (event: GameEvent) => void,
): Promise<() => Promise<void>> {
  const channel = REDIS_KEYS.gameStream(gameId);
  const handler = (incomingChannel: string, message: string): void => {
    if (incomingChannel !== channel) {
      return;
    }

    onEvent(JSON.parse(message) as GameEvent);
  };

  redis.on("message", handler);
  await redis.subscribe(channel);

  return async () => {
    redis.off("message", handler);
    await redis.unsubscribe(channel);
  };
}

export async function readGameEvents(
  redis: Redis,
  gameId: string,
  sinceId = "0-0",
  count = 100,
): Promise<GameEvent[]> {
  const rows = await redis.xrange(
    REDIS_KEYS.gameStream(gameId),
    sinceId,
    "+",
    "COUNT",
    count,
  );

  return rows.flatMap(([, fields]) => {
    const eventIndex = fields.findIndex((field) => field === "event");
    if (eventIndex === -1 || !fields[eventIndex + 1]) {
      return [];
    }

    return [JSON.parse(fields[eventIndex + 1]) as GameEvent];
  });
}

export async function closeRedisClients(): Promise<void> {
  await Promise.all(
    [commandClient, publisherClient, subscriberClient]
      .filter((client): client is Redis => Boolean(client))
      .map((client) => client.quit().catch(() => client.disconnect())),
  );
  commandClient = undefined;
  publisherClient = undefined;
  subscriberClient = undefined;
}
