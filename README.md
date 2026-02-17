# soft-deletion

A production-grade plugin for [Better Auth](https://better-auth.com) that implements soft deletion for users, preventing permanent record loss and controlling re-registration.

## Features

- **Soft Delete**: Overrides the default delete behavior to mark users as `deleted` and record the `deletedAt` timestamp.
- **Password Confirmation for Deletion**: Requires the user to confirm their password before deletion is processed.
- **Login Prevention**: Automatically blocks users with `status: "deleted"` from signing in.
- **Re-registration Protection**: Hashes user identifiers (emails) and blocks them from signing up again for a configurable retention period.
- **Secondary Storage Support**: Optionally use Redis or other KV stores for high-performance blocked identifier checks.
- **Account Restoration**: Secure endpoint to restore a soft-deleted account.
- **CLI Compatible**: Works seamlessly with `npx better-auth migrate` and ORM generators.
- **NPM Ready**: Packaged for distribution with full TypeScript support (ESM/CJS).

## Installation

```bash
npm install soft-deletion
# or
bun add soft-deletion
```

## Server Usage

```typescript
// auth.ts
import { betterAuth } from "better-auth";
import { softDeletion } from "soft-deletion";

export const auth = betterAuth({
    database: // your adapter,
    plugins: [
        softDeletion({
            retentionDays: 30, // Default is 30
            blockReRegistration: true, // Default is true
            // secondaryStorage: redisStorage // Optional
        })
    ]
});
```

## Client Usage

```typescript
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { softDeletionClient } from "soft-deletion/client";

export const authClient = createAuthClient({
    plugins: [
        softDeletionClient()
    ]
});

// To restore an account (user must be authenticated)
const { data, error } = await authClient.restoreAccount();

// To delete an account (user must provide password confirmation)
await authClient.deleteUser({
    password: "current-password"
});
```

## Architecture

- **`index.ts`**: Server-side plugin.
- **`client.ts`**: Client-side plugin.
- **`types.ts`**: Shared TypeScript definitions.
- **`utils.ts`**: Privacy-focused hashing utilities.

## Lifecycle Flow

1. **Delete Request**: User calls `deleteUser({ password })`.
2. **Password Check**: `hooks.before` on `/delete-user` verifies the provided password.
3. **Hook Execution**: `databaseHooks.user.delete.before` triggers via the `init` function.
4. **Soft Mark**: Plugin updates user `status` to `"deleted"` and sets `deletedAt`.
5. **Block Entry**: A hashed entry of the email is added to the `blockedIdentifier` table.
6. **Intercept**: The hook returns `false`, telling the adapter to skip the hard delete.
7. **Sign-In Protection**: `hooks.before` checks if the email trying to sign in belongs to a `"deleted"` user.
8. **Sign-Up Protection**: `hooks.before` hashes the sign-up email and checks it against the `blockedIdentifier` table.

## Security & Edge Cases

- **Identifier Hashing**: Emails are hashed using SHA-256 before storage in `blockedIdentifier` to protect user privacy.
- **Deletion Confirmation**: Account deletion requires current password confirmation.
- **Login after Delete**: If a user attempts to log in after being soft-deleted, they receive a `FORBIDDEN` error.
- **OAuth-only Accounts**: Accounts without a credential password cannot complete this delete flow unless an alternative verification flow is added.
- **Restore Race Condition**: Restoration resets the status to `active` and removes the blocked identifier entry.
- **Cleanup**: Blocked identifiers have an `expiresAt` field. Use a cron job to clean up expired entries from the `blockedIdentifier` table.

## Database Migrations

Run your ORM's migration tool or Better Auth CLI to add the necessary fields and tables:

```bash
npx @better-auth/cli migrate
```

The plugin adds:
- `user.status` (string)
- `user.deletedAt` (date)
- `blockedIdentifier` table
