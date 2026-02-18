import { BetterAuthPlugin, APIError } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { hashIdentifier } from "./utils";
import {
    RestoreAccountInput,
    SoftDeletionAccountRecord,
    SoftDeletionHookContext,
    SoftDeletionOptions,
    SoftDeletionUserRecord,
} from "./types";

export { softDeletionClient } from "./client";

export const softDeletion = (options?: SoftDeletionOptions) => {
    const retentionDays = options?.retentionDays ?? 30;
    const blockReRegistration = options?.blockReRegistration ?? true;
    const restoreAccountBodySchema = z.object({
        email: z.string().email(),
        password: z.string().min(1),
    });
    const toHookContext = (value: unknown): SoftDeletionHookContext | null => {
        if (!value || typeof value !== "object") return null;
        return value as SoftDeletionHookContext;
    };

    const readEmailFromBody = (body: unknown): string | null => {
        if (!body || typeof body !== "object" || !("email" in body)) {
            return null;
        }
        const email = (body as { email?: unknown }).email;
        if (typeof email !== "string") return null;
        return email.toLowerCase().trim();
    };

    const getDeletionMetadata = (deletedAt?: Date | string | null) => {
        const deletedDate = deletedAt ? new Date(deletedAt) : new Date();
        const scheduled = new Date(deletedDate);
        scheduled.setDate(scheduled.getDate() + retentionDays);
        return {
            deletedAt: deletedDate.toISOString(),
            scheduledDeletionDate: scheduled.toISOString(),
        };
    };

    const clearBlockedIdentifier = async (
        adapter: SoftDeletionHookContext["context"]["adapter"],
        email?: string | null,
    ) => {
        if (!email) return;
        const hash = await hashIdentifier(email);

        await adapter.delete?.({
            model: "blockedIdentifier",
            where: [
                { field: "identifierHash", value: hash },
                { field: "type", value: "email" }
            ]
        });
    };
    const revokeAllUserSessions = async (ctx: SoftDeletionHookContext, userId: string | number) => {
        const internalAdapter = ctx?.context?.internalAdapter;
        if (internalAdapter?.deleteSessions) {
            await internalAdapter.deleteSessions(userId);
            return;
        }

        const adapter = ctx?.adapter ?? ctx?.context?.adapter;
        if (!adapter?.delete) return;

        await adapter.delete({
            model: "session",
            where: [{ field: "userId", value: userId }],
        });
    };
    return {
        id: "SoftDeletion",
        init: () => ({
            options: {
                databaseHooks: {
                    account: {
                        delete: {
                            before: async (account, ctx) => {
                                const parsedCtx = toHookContext(ctx);
                                const parsedAccount = account as SoftDeletionAccountRecord | undefined;
                                // Keep credential account row during soft delete so restore can verify password.
                                if (parsedCtx?.path === "/delete-user" && parsedAccount?.providerId === "credential") {
                                    return false;
                                }
                            },
                        },
                    },
                    user: {
                        delete: {
                            before: async (user, ctx) => {
                                const parsedCtx = toHookContext(ctx);
                                if (!parsedCtx) {
                                    throw new APIError("INTERNAL_SERVER_ERROR", {
                                        code: "SD_CONTEXT_INVALID",
                                        message: "Soft deletion context is unavailable.",
                                    });
                                }
                                const parsedUser = user as SoftDeletionUserRecord;
                                const adapter = parsedCtx?.adapter ?? parsedCtx?.context?.adapter;

                                if (!adapter) {
                                    throw new APIError("INTERNAL_SERVER_ERROR", {
                                        code: "SD_ADAPTER_CTX_MISSING",
                                        message: "Soft deletion adapter context is unavailable.",
                                    });
                                }

                                // Revoke all active sessions immediately for this user.
                                await revokeAllUserSessions(parsedCtx, parsedUser.id);

                                // Soft delete instead of hard delete
                                await adapter.update({
                                    model: "user",
                                    where: [{ field: "id", value: parsedUser.id }],
                                    update: {
                                        status: "deleted",
                                        deletedAt: new Date(),
                                    },
                                });

                                if (blockReRegistration && parsedUser.email) {
                                    const hash = await hashIdentifier(parsedUser.email);
                                    const expiresAt = new Date();
                                    expiresAt.setDate(expiresAt.getDate() + retentionDays);
                                    const where = [
                                        { field: "identifierHash", value: hash },
                                        { field: "type", value: "email" },
                                    ];
                                    const existing = await adapter.findOne({
                                        model: "blockedIdentifier",
                                        where,
                                    });
                                    const data = {
                                        identifierHash: hash,
                                        type: "email",
                                        expiresAt,
                                    };
                                    if (existing) {
                                        await adapter.update({
                                            model: "blockedIdentifier",
                                            where,
                                            update: { expiresAt },
                                        });
                                    } else {
                                        // Save to blockedIdentifier table
                                        await adapter.create?.({
                                            model: "blockedIdentifier",
                                            data,
                                        });
                                    }

                                }

                                // Return false to prevent actual deletion from DB
                                return false;
                            },
                        },
                    },
                },
            },
        }),
        schema: {
            user: {
                fields: {
                    status: {
                        type: "string",
                        defaultValue: "active",
                    },
                    deletedAt: {
                        type: "date",
                        required: false,
                    },
                },
            },
            blockedIdentifier: {
                fields: {
                    identifierHash: {
                        type: "string",
                        required: true,
                    },
                    type: {
                        type: "string",
                        required: true,
                    },
                    expiresAt: {
                        type: "date",
                        required: false,
                    },
                },
            },
        },
        hooks: {
            before: [
                {
                    matcher: (ctx) => (toHookContext(ctx)?.path ?? "").startsWith("/sign-in"),
                    handler: async (ctx) => {
                        const parsedCtx = toHookContext(ctx);
                        if (!parsedCtx) return;
                        const email = readEmailFromBody(parsedCtx.body);
                        if (!email) return;

                        const user = (await parsedCtx.context.adapter.findOne({
                            model: "user",
                            where: [{ field: "email", value: email }],
                        })) as SoftDeletionUserRecord | null;

                        if (user && user.status === "deleted") {
                            throw new APIError("FORBIDDEN", {
                                code: "ACCOUNT_DELETED",
                                message: "Your account has been deleted.",
                                details: getDeletionMetadata(user.deletedAt),
                            });
                        }
                    },
                },
                {
                    matcher: (ctx) => toHookContext(ctx)?.path === "/sign-up/email",
                    handler: async (ctx) => {
                        const parsedCtx = toHookContext(ctx);
                        if (!parsedCtx) return;
                        const email = readEmailFromBody(parsedCtx.body);
                        if (!email) return;

                        const hash = await hashIdentifier(email);

                        // DB-based blocked identifier check
                        const blocked = (await parsedCtx.context.adapter.findOne({
                            model: "blockedIdentifier",
                            where: [
                                { field: "identifierHash", value: hash },
                                { field: "type", value: "email" },
                            ],
                        })) as { expiresAt?: Date | string | null } | null;

                        if (blocked) {
                            if (blocked.expiresAt && blocked.expiresAt < new Date()) {
                                return;
                            }
                            throw new APIError("FORBIDDEN", {
                                code: "EMAIL_BLOCKED",
                                message: "This email is not allowed to register.",
                            });
                        }
                    },
                },
            ],
        },
        endpoints: {
            restoreAccount: createAuthEndpoint(
                "/SoftDeletion/restore",
                {
                    method: "POST",
                    body: restoreAccountBodySchema,
                },
                async (ctx) => {
                    const parsedCtx = toHookContext(ctx);
                    if (!parsedCtx) {
                        throw new APIError("INTERNAL_SERVER_ERROR", {
                            code: "SD_CONTEXT_INVALID",
                            message: "Soft deletion context is unavailable.",
                        });
                    }

                    const parsed = restoreAccountBodySchema.safeParse(parsedCtx.body);
                    if (!parsed.success) {
                        throw new APIError("BAD_REQUEST", {
                            code: "RESTORE_INPUT_REQUIRED",
                            message: "Email and password are required to restore account.",
                        });
                    }
                    const { email, password } = parsed.data as RestoreAccountInput;

                    if (options?.restoreRateLimit) {
                        const decision = await options.restoreRateLimit({
                            email,
                            context: parsedCtx,
                        });

                        const blocked =
                            decision === false ||
                            (typeof decision === "object" &&
                                decision !== null &&
                                "allowed" in decision &&
                                decision.allowed === false);

                        if (blocked) {
                            const payload =
                                typeof decision === "object" && decision !== null
                                    ? decision
                                    : undefined;

                            throw new APIError("TOO_MANY_REQUESTS", {
                                code: payload?.code || "RESTORE_RATE_LIMITED",
                                message: payload?.message || "Too many restore attempts. Please try again later.",
                                status: payload?.status || 429,
                            });
                        }
                    }

                    const user = (await parsedCtx.context.adapter.findOne({
                        model: "user",
                        where: [{ field: "email", value: email }],
                    })) as SoftDeletionUserRecord | null;

                    if (!user) {
                        throw new APIError("UNAUTHORIZED", {
                            code: "AUTH_INVALID_CREDENTIALS",
                            message: "Invalid email or password.",
                        });
                    }

                    if (user.status !== "deleted") {
                        throw new APIError("BAD_REQUEST", {
                            code: "ACCOUNT_NOT_DELETED",
                            message: "Account is not deleted.",
                        });
                    }

                    const account = (await parsedCtx.context.adapter.findOne({
                        model: "account",
                        where: [
                            { field: "userId", value: user.id },
                            { field: "providerId", value: "credential" },
                        ],
                    })) as SoftDeletionAccountRecord | null;

                    const currentPassword = account?.password;
                    if (!currentPassword) {
                        throw new APIError("BAD_REQUEST", {
                            code: "NO_PASSWORD_CREDENTIAL",
                            message: "Password confirmation is not available for this account.",
                        });
                    }

                    const validPassword = await parsedCtx.context.password.verify({
                        hash: currentPassword,
                        password,
                    });
                    if (!validPassword) {
                        throw new APIError("UNAUTHORIZED", {
                            code: "AUTH_INVALID_CREDENTIALS",
                            message: "Invalid email or password.",
                        });
                    }

                    await parsedCtx.context.adapter.update({
                        model: "user",
                        where: [{ field: "id", value: user.id }],
                        update: {
                            status: "active",
                            deletedAt: null,
                        },
                    });
                    await clearBlockedIdentifier(parsedCtx.context.adapter, user.email);

                    return parsedCtx.json({
                        message: "Account restored successfully.",
                    });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
};
