# API and WebSocket Session Auth

The authoritative services now require an HMAC-signed session token for game actions.

## Token format

- Token: `<base64url(payload)>.<base64url(hmac_sha256_signature)>`
- Payload fields:
  - `userId` (required)
  - `exp` unix epoch in milliseconds (required)
  - `gameIds` allow-list for game access (optional for admin)
  - `role` (`player` | `viewer` | `admin`)

## Secret management

Set `SESSION_SECRET` in each environment. Never use the local default value in production.

## Enforcement points

- `server/ws.ts` requires `?token=...` on connect and validates access on `join`, `recover`,
  and `move` actions.
- `app/api/game/route.ts` requires `token` in POST body and enforces role/game ownership.

## Minimal workflow

1. Auth service issues signed token with short expiration and allowed game IDs.
2. Client connects to WS with the token and uses same token for API fallback calls.
3. Server rejects mismatched, expired, or unauthorized actions.
