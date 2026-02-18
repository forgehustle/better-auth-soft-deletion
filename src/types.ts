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
     * Optional hook to rate-limit restore attempts (for brute-force protection).
     * Return `false` or `{ allowed: false }` to block the attempt.
     */
    restoreRateLimit?: (
        params: { email: string; context: unknown }
    ) => Promise<boolean | RestoreRateLimitResult> | boolean | RestoreRateLimitResult;
}

export interface BlockedIdentifier {
    id: string;
    identifierHash: string;
    type: string;
    expiresAt?: Date;
    createdAt: Date;
}

export interface RestoreRateLimitResult {
    allowed: boolean;
    code?: string;
    message?: string;
    status?: number;
}

export interface RestoreAccountInput {
    email: string;
    password: string;
}

export interface RestoreAccountSuccess {
    message: string;
}

export type QueryWhere = Array<{ field: string; value: unknown }>;

export interface SoftDeletionAdapter {
    findOne(input: { model: string; where: QueryWhere }): Promise<unknown>;
    update(input: { model: string; where: QueryWhere; update: Record<string, unknown> }): Promise<void>;
    create?(input: { model: string; data: Record<string, unknown> }): Promise<void>;
    delete?(input: { model: string; where: QueryWhere }): Promise<void>;
}

export interface SoftDeletionInternalAdapter {
    deleteSessions?: (userId: string | number) => Promise<void>;
}

export interface RuntimePassword {
    verify(input: { hash: string; password: string }): Promise<boolean>;
}

export interface SoftDeletionHookContext {
    path?: string;
    body?: unknown;
    query?: unknown;
    headers?: Headers;
    request?: Request;
    adapter?: SoftDeletionAdapter;
    context: {
        adapter: SoftDeletionAdapter;
        internalAdapter?: SoftDeletionInternalAdapter;
        password: RuntimePassword;
    };
    json(payload: RestoreAccountSuccess): RestoreAccountSuccess;
}

export interface SoftDeletionUserRecord {
    id: string | number;
    email?: string | null;
    status?: string | null;
    deletedAt?: Date | string | null;
}

export interface SoftDeletionAccountRecord {
    providerId?: string | null;
    password?: string | null;
}
