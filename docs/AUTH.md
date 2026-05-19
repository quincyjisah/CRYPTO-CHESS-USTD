# API and WebSocket Session Auth

The authoritative services require HMAC-signed session tokens for game actions.

## Token format

- Token: `<base64url(payload)>.<base64url(hmac_sha256_signature)>`
- Payload fields:
  - `userId` (required)
  - `exp` unix epoch in milliseconds (required)
  - `jti` unique token id (required)
  - `kid` key id for signing-secret lookup (required)
  - `iat` issued-at timestamp (optional)
  - `nbf` not-before timestamp (optional)
  - `gameIds` allow-list for game access (optional for admin)
  - `role` (`player` | `viewer` | `admin`)

## Secret management and rotation

- `SESSION_SECRETS` stores comma-separated key material as `kid:secret` pairs.
- `SESSION_ACTIVE_KID` selects the key used for newly signed tokens.
- Verification uses the token payload `kid` to select the matching secret.
- Rotate by adding a new key, switching `SESSION_ACTIVE_KID`, then retiring old keys after
  existing token expiry windows pass.

Example:

```bash
SESSION_SECRETS=k1:old-secret,k2:new-secret
SESSION_ACTIVE_KID=k2
```

## Revocation

- Tokens include `jti` and are checked against `auth:revoked:{jti}` in Redis.
- Revoked tokens are rejected by API and WebSocket paths before action execution.
- Revocation entries use TTL through token expiry to avoid unbounded growth.

## Enforcement points

- `server/ws.ts` requires `?token=...` on connect, validates signature/expiry/revocation,
  and checks game access on `join`, `recover`, and `move`.
- `app/api/game/route.ts` requires `token` in POST body and enforces revocation,
  role constraints, and game ownership.

## Minimal workflow

1. Auth service issues signed token with short expiration and allowed game IDs.
2. Client connects to WS with the token and uses same token for API fallback calls.
3. Server rejects mismatched, revoked, expired, or unauthorized actions.
