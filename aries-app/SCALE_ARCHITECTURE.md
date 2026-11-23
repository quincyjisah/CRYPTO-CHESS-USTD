# Aries Protocol — Scalability Architecture
## From 10 players to 100,000 players

---

## Current architecture (10–1,000 players)

```
Users → Firebase Hosting / Vercel
      → Firestore (rules + indexes)
      → Alchemy API (NFT + RPC)
      → Ethereum Mainnet (settlements)
```

This works well up to ~1,000 concurrent users with zero changes.

---

## Phase 1: 1,000–10,000 players

### Firestore scaling (automatic)
Firestore scales horizontally by default. The indexes in `firestore.indexes.json` are the critical lever — all query patterns are indexed, so Firestore never does collection scans. No action needed.

### Add Firestore bundle caching
For read-heavy pages (leaderboard, NFT vault), pre-bundle Firestore snapshots on a Cloud Function and serve them via Firebase Hosting CDN. Reduces Firestore read costs by ~80%.

```typescript
// Cloud Function (functions/src/bundleLeaderboard.ts)
import { getFirestore } from 'firebase-admin/firestore';
import { loadBundle, namedQuery } from 'firebase/firestore';

export const bundleLeaderboard = onSchedule('every 5 minutes', async () => {
  const db = getFirestore();
  const bundle = db.bundle('leaderboard-bundle');
  const top100 = await db.collection('profiles')
    .orderBy('profit', 'desc').limit(100).get();
  bundle.add('top100', top100);
  // Store bundle in Cloud Storage → serve via Firebase Hosting
});
```

### Move game settlement to Cloud Functions
Currently clients write their own settlement. At scale, a rogue client could write a fabricated result. Move all settlement writes behind a Cloud Function that re-validates the chess position before paying out.

```typescript
// functions/src/settleGame.ts
export const settleGame = onDocumentUpdated('games/{gameId}', async (event) => {
  const after = event.data.after.data();
  if (after.status !== 'finished' || after.settled) return;

  const { Chess } = require('chess.js');
  const game = new Chess();
  // Replay all moves from after.moves array to verify the result
  for (const move of after.moves) game.move(move);

  const verifiedResult = game.isCheckmate() ? after.turn === 'white' ? 'black' : 'white'
    : game.isDraw() ? 'draw' : null;

  if (verifiedResult !== after.result) {
    // Fraudulent result detected — reverse and flag
    await event.data.after.ref.update({ status: 'disputed', settled: false });
    return;
  }

  // Execute settlement with admin SDK (bypasses client rules)
  await settleWithAdminSDK(event.params.gameId, verifiedResult, after);
});
```

### Alchemy rate limits
Free Alchemy plan: 300 CUPS (compute units per second). At 10,000 users, upgrade to Alchemy Growth ($49/mo) for 660 CUPS. Cache NFT metadata in Firestore so the Alchemy API is only called on cache miss.

```typescript
// src/lib/nft.ts — add Firestore cache layer
export async function fetchContractNFTsCached(limit = 64): Promise<NftToken[]> {
  const cacheRef = doc(db, 'cache', 'nft-metadata');
  const cached = await getDoc(cacheRef);

  if (cached.exists()) {
    const age = Date.now() - cached.data().cachedAt.toMillis();
    if (age < 5 * 60 * 1000) return cached.data().tokens; // 5-min cache
  }

  const tokens = await fetchContractNFTs(limit);
  await setDoc(cacheRef, { tokens, cachedAt: serverTimestamp() });
  return tokens;
}
```

---

## Phase 2: 10,000–50,000 players

### Firestore → Firestore + Redis (Upstash)
Hot data (active match state, live leaderboard, tip feeds) moves to Upstash Redis for sub-millisecond reads. Firestore remains the source of truth.

```bash
npm install @upstash/redis
```

```typescript
// src/lib/redis.ts
import { Redis } from '@upstash/redis';
export const redis = new Redis({
  url: process.env.VITE_UPSTASH_URL!,
  token: process.env.VITE_UPSTASH_TOKEN!,
});

// Cache active game state in Redis with 60s TTL
export async function cacheGameState(gameId: string, state: any) {
  await redis.set(`game:${gameId}`, JSON.stringify(state), { ex: 60 });
}
```

### WebSocket relay for multiplayer
Replace Firestore `onSnapshot` for real-time move sync with a dedicated WebSocket server (Ably or Pusher). Firestore `onSnapshot` costs 1 read per change per listener. At 50,000 concurrent games, that is 50,000+ reads/second.

```bash
npm install ably
```

```typescript
// src/lib/realtime.ts
import Ably from 'ably';
const ably = new Ably.Realtime({ key: process.env.VITE_ABLY_KEY });

export function subscribeToGame(gameId: string, onMove: (fen: string) => void) {
  const channel = ably.channels.get(`game:${gameId}`);
  channel.subscribe('move', (msg) => onMove(msg.data.fen));
  return () => channel.unsubscribe();
}

export function publishMove(gameId: string, fen: string) {
  const channel = ably.channels.get(`game:${gameId}`);
  channel.publish('move', { fen });
}
```

### CDN for static assets
All images, chess piece SVGs, and audio files behind Cloudflare CDN. Add to `firebase.json` hosting:

```json
{
  "hosting": {
    "headers": [{
      "source": "/assets/**",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }]
  }
}
```

### AdSense scaling
At 50,000 monthly visitors, apply to AdSense premium (Google Ad Manager). CPM rates increase 3–5× versus standard AdSense. Contact your AdSense rep at quincy.j.isah@gmail.com to request review.

---

## Phase 3: 50,000–100,000 players

### Shard the matchmaking queue
A single `/matchmaking` collection becomes a hotspot at high concurrency. Shard across 10 subcollections, routing players by wager range.

```typescript
// src/lib/useMatchmaking.ts
function queueShard(wager: number): string {
  if (wager <= 10)  return 'shard_micro';
  if (wager <= 50)  return 'shard_small';
  if (wager <= 200) return 'shard_mid';
  return 'shard_whale';
}

// Write to: matchmaking_shards/{shard}/entries/{uid}
// Query from: matchmaking_shards/{shard}/entries
```

### Cloud Run auto-scaling
Move the backend settlement logic to Cloud Run (already the deployment target). Cloud Run auto-scales from 0 to 1,000 instances in seconds. Set:

```yaml
# cloud-run-config.yaml
resources:
  limits:
    cpu: "2"
    memory: "1Gi"
autoscaling:
  minInstances: 2    # keep warm — no cold start for game settlements
  maxInstances: 1000
```

### Ethereum L2 for micro-wagers
Low wagers (1–10 USDT) become gas-inefficient on Ethereum Mainnet at scale. Add Polygon or Arbitrum as an optional L2 network, with the same contract deployed there. Bridge USDT automatically for wagers under $20.

```typescript
// src/lib/ethers.ts — add L2 support
const SUPPORTED_CHAINS = {
  1:       { name: 'Ethereum Mainnet', rpc: 'https://eth-mainnet.g.alchemy.com/v2/KEY' },
  137:     { name: 'Polygon',          rpc: 'https://polygon-mainnet.g.alchemy.com/v2/KEY' },
  42161:   { name: 'Arbitrum One',     rpc: 'https://arb-mainnet.g.alchemy.com/v2/KEY' },
};
```

### Fraud detection
At scale, automated bots will attempt collusion and fake draws. Add a Cloud Function that flags suspicious patterns:

```typescript
// Flag games where:
// - Same two wallets play > 10 times in 24 hours
// - A player wins 95%+ of games (bot assistance)
// - Game ends in < 5 moves (suspicious draws)
export const fraudDetection = onDocumentCreated('transactions/{id}', async (event) => {
  const data = event.data.data();
  if (data.type !== 'Match') return;
  await runFraudChecks(data.userId, data.gameId);
});
```

---

## Fee revenue projection

| Players/day | Avg wager | Matches/day | 2% fee/match | Daily revenue |
|------------|-----------|-------------|-------------|---------------|
| 100        | $20       | 50          | $0.40       | $20           |
| 1,000      | $25       | 500         | $0.50       | $250          |
| 10,000     | $30       | 5,000       | $0.60       | $3,000        |
| 50,000     | $35       | 25,000      | $0.70       | $17,500       |
| 100,000    | $40       | 50,000      | $0.80       | $40,000       |

Fee formula: `pot × 0.02` where `pot = wager × 2`

---

## Monitoring checklist at each phase

- Firebase Console → Quotas tab: watch reads/writes/deletes per day
- Alchemy Dashboard → Compute Units used per second
- Google Cloud Console → Cloud Run → Request latency P99
- Etherscan → contract → watch for unexpected transactions
- Sentry → client error rate (set up via `npm install @sentry/react`)
- Google AdSense → RPM and fill rate by country
