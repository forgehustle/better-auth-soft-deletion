import type { BetterAuthOptions, SecondaryStorage } from "better-auth";

export interface SoftDeletionOptions {
    /**
     * Number of days to retain the blocked identifier.
     * @default 30
     */
    retentionDays?: number;
    /**
     * Whether to block re-registration for deleted users.
     * @default true
     */
    blockReRegistration?: boolean;
    /**
     * Optional secondary storage (e.g. Redis) for blocked identifiers.
     */
    secondaryStorage?: SecondaryStorage;
}

export interface BlockedIdentifier {
    id: string;
    identifierHash: string;
    type: string;
    expiresAt?: Date;
    createdAt: Date;
}
