# Corrected Architecture Overview

Crypto Chess is now shaped as a distributed, authoritative gaming system rather than a
client-trusted board. The browser is only a window; the server is the judge.

## Runtime services

- **App service:** serves the built web client and exposes health checks.
- **WebSocket authority nodes (`ws1`, `ws2`, ...):** validate real-time moves, maintain room
  membership, heartbeat clients, and recover missed events from Redis Streams.
- **Matchmaker service:** consumes `queue:matchmaking`, pairs equal-wager players, creates
  games, and locks simulated escrow.
- **Redis:** stores game FEN state, hash-linked ledgers, event streams, matchmaking queues,
  rate-limit counters, simulated balances, and suspicious-user flags.
- **Nginx:** load balances WebSocket nodes, preserves upgrade headers, and proxies app
  traffic.

## Redis key map

- `game:{id}` — authoritative FEN and game metadata.
- `ledger:{id}` — append-only hash-linked move chain.
- `stream:game:{id}` — replayable event stream for reconnect recovery.
- `queue:matchmaking` — Redis-backed player matchmaking queue.
- `funds:{symbol}:{userId}` — simulated token balances.
- `escrow:{gameId}` — locked wager record.
- `economy:txlog` — transparent transaction stream.

## Scale path

The first launch target is 10k concurrent players with horizontal WebSocket replicas and
Redis-backed cross-node synchronization. The path to 1M concurrent players requires Redis
Cluster or sharded state, regional room placement, autoscaled WebSocket fleets, queue-based
settlement workers, CDN-hosted static assets, load testing, observability, and operational
runbooks.
