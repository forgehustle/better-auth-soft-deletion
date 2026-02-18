# @forgehustle/better-auth-soft-deletion

Soft deletion plugin for [Better Auth](https://better-auth.com) with:
- user soft delete (`status = "deleted"`, `deletedAt`)
- sign-in blocking for deleted users
- optional re-registration blocking during retention window
- account restore endpoint
- immediate revocation of all user sessions on delete

## What this plugin does

When a user deletes their account:
1. User row is kept (not hard-deleted)
2. `status` becomes `"deleted"` and `deletedAt` is set
3. All active sessions are revoked
4. (Optional) Email is blocked from re-registering for `retentionDays`

When a deleted user tries to sign in:
- plugin returns `403 FORBIDDEN` with code `ACCOUNT_DELETED`

When restore is called with valid email/password:
- user status is set back to `"active"`
- `deletedAt` is cleared
- blocked identifier entry is removed

Restore endpoint exposed by this plugin:
- `POST /soft-deletion/restore`

---

## Installation

```bash
npm install @forgehustle/better-auth-soft-deletion
# or
bun add @forgehustle/better-auth-soft-deletion
```

---

## Server setup (Better Auth)

```ts
import { betterAuth } from "better-auth";
import { softDeletion } from "@forgehustle/better-auth-soft-deletion";

export const auth = betterAuth({
  // your adapter
  // database: drizzleAdapter(...)
  plugins: [
    softDeletion({
      retentionDays: 30,         // default: 30
      blockReRegistration: true, // default: true
    }),
  ],
  user: {
    deleteUser: {
      enabled: true,
    },
  },
});
```

Important:
- `deleteUser` must be enabled in Better Auth config.
- your client should send password confirmation to delete account (`password` string).

---

## Client setup

```ts
import { createAuthClient } from "better-auth/react";
import { softDeletionClient } from "@forgehustle/better-auth-soft-deletion/client";

export const authClient = createAuthClient({
  baseURL: "http://localhost:5000/auth", // adjust for your app
  plugins: [softDeletionClient()],
});
```

Important:
- Prefer plugin actions from `authClient` for restore operations.
- Avoid manual `fetch` calls to plugin endpoints in React apps.

---

## Usage examples

### Delete account (requires password confirmation)

```ts
await authClient.deleteUser({
  password: "CurrentPassword123!",
});
```

If password is missing/invalid shape, Better Auth will reject the request.

### Restore account (recommended)

```ts
const { data, error } = await authClient.restoreAccount({
  email: "user@example.com",
  password: "CurrentPassword123!",
});

if (error) {
  // handle by error.code
  console.error(error.code, error.message);
} else {
  console.log(data.message); // "Account restored successfully."
}
```

---

## Options

```ts
type SoftDeletionOptions = {
  retentionDays?: number;         // default: 30
  blockReRegistration?: boolean;  // default: true
  restoreRateLimit?: (
    params: { email: string; context: unknown }
  ) => boolean | { allowed: boolean; code?: string; message?: string; status?: number };
};
```

---

## Added schema

This plugin extends Better Auth schema with:

- `user.status` (`string`, default: `"active"`)
- `user.deletedAt` (`date | null`)
- `blockedIdentifier` model:
  - `identifierHash`
  - `type`
  - `expiresAt`

Run your Better Auth/ORM migration flow after enabling plugin schema changes.

---

## Error codes you should handle on client

- `ACCOUNT_DELETED` (403): deleted user attempted sign-in
- `EMAIL_BLOCKED` (403): re-registration blocked during retention window
- `RESTORE_INPUT_REQUIRED` (400): email/password missing on restore
- `ACCOUNT_NOT_DELETED` (400): restore requested for active account
- `NO_PASSWORD_CREDENTIAL` (400): credential password not available (for example OAuth-only account)
- `AUTH_INVALID_CREDENTIALS` (401): invalid email/password on restore

---

## Security notes

- Always send restore credentials in POST JSON body.
- Do not put email/password in query string.
- Revoke sessions on delete is already built in:
  - uses Better Auth internal adapter `deleteSessions(userId)` when available
  - fallback removes `session` model rows by `userId`
- If your app uses Better Auth `session.cookieCache`, revoked sessions may appear active until cache refresh on other devices. For strict behavior, disable cookie cache or force `disableCookieCache: true` on session refresh checks.

---

## Troubleshooting

- `Password confirmation is required to delete your account`:
  - ensure `deleteUser({ password: "..." })` is sent with `password` as string.

- `VALIDATION_ERROR [body.password] expected string, received object`:
  - your payload shape is wrong. Send a plain string value for `password`.

- `RESTORE_INPUT_REQUIRED`:
  - restore request is missing `email` or `password`.
  - verify request body is JSON and keys are exact: `email`, `password`.

- Deleted user can still access protected routes on another browser:
  - this is usually session cookie cache behavior, not DB/Redis session persistence.
  - disable Better Auth session cookie cache for strict immediate invalidation.

---

## License

MIT
