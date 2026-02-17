import { BetterAuthPlugin, APIError } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { hashIdentifier } from "./utils";
import { SoftDeletionOptions } from "./types";

export const softDeletion = (options?: SoftDeletionOptions) => {
    const retentionDays = options?.retentionDays ?? 30;
    const blockReRegistration = options?.blockReRegistration ?? true;

    return {
        id: "SoftDeletion",
        init: () => ({
            options: {
                databaseHooks: {
                    user: {
                        delete: {
                            before: async (user: any, ctx: any) => {
                                const adapter = ctx?.adapter ?? ctx?.context?.adapter;
                                const generateId = ctx?.generateId ?? ctx?.context?.generateId;

                                if (!adapter) {
                                    throw new APIError("INTERNAL_SERVER_ERROR", {
                                        message: "Soft deletion adapter context is unavailable.",
                                    });
                                }

                                // Soft delete instead of hard delete
                                await adapter.update({
                                    model: "user",
                                    where: [{ field: "id", value: user.id }],
                                    update: {
                                        status: "deleted",
                                        deletedAt: new Date(),
                                    },
                                });

                                if (blockReRegistration && user.email) {
                                    const hash = await hashIdentifier(user.email);
                                    const expiresAt = new Date();
                                    expiresAt.setDate(expiresAt.getDate() + retentionDays);
                                    const generatedId =
                                        typeof generateId === "function"
                                            ? await Promise.resolve(
                                                  generateId({ model: "blockedIdentifier" })
                                              )
                                            : undefined;

                                    const data = {
                                        identifierHash: hash,
                                        type: "email",
                                        expiresAt,
                                        createdAt: new Date(),
                                        ...(generatedId !== undefined && generatedId !== false
                                            ? { id: generatedId }
                                            : {}),
                                    };

                                    // Save to blockedIdentifier table
                                    await adapter.create({
                                        model: "blockedIdentifier",
                                        data,
                                    });

                                    // Save to secondary storage if available
                                    if (options?.secondaryStorage) {
                                        await options.secondaryStorage.set(
                                            `blocked-email:${hash}`,
                                            "true",
                                            retentionDays * 24 * 60 * 60
                                        );
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
                    matcher: (ctx: any) => ctx.path === "/delete-user",
                    handler: async (ctx: any) => {
                        const body = ctx.body as any;
                        const password = typeof body?.password === "string" ? body.password.trim() : "";

                        if (!password) {
                            throw new APIError("BAD_REQUEST", {
                                message: "Password confirmation is required to delete your account.",
                            });
                        }
                    },
                },
                {
                    matcher: (ctx: any) => ctx.path.startsWith("/sign-in"),
                    handler: async (ctx: any) => {
                        const body = ctx.body as any;
                        if (!body?.email) return;

                        const user = await ctx.context.adapter.findOne({
                            model: "user",
                            where: [{ field: "email", value: body.email.toLowerCase().trim() }],
                        });

                        if (user && user.status === "deleted") {
                            throw new APIError("FORBIDDEN", {
                                message: "Your account has been deleted.",
                            });
                        }
                    },
                },
                {
                    matcher: (ctx: any) => ctx.path === "/sign-up/email",
                    handler: async (ctx: any) => {
                        const body = ctx.body as any;
                        if (!body?.email) return;

                        const hash = await hashIdentifier(body.email);

                        // Check secondary storage first
                        if (options?.secondaryStorage) {
                            const isBlocked = await options.secondaryStorage.get(`blocked-email:${hash}`);
                            if (isBlocked) {
                                throw new APIError("FORBIDDEN", {
                                    message: "This email is not allowed to register.",
                                });
                            }
                        }

                        // Fallback to database
                        const blocked = await ctx.context.adapter.findOne({
                            model: "blockedIdentifier",
                            where: [
                                { field: "identifierHash", value: hash },
                                { field: "type", value: "email" },
                            ],
                        });

                        if (blocked) {
                            if (blocked.expiresAt && blocked.expiresAt < new Date()) {
                                return;
                            }
                            throw new APIError("FORBIDDEN", {
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
                    useSession: true,
                },
                async (ctx: any) => {
                    const session = ctx.context.session;
                    if (!session) {
                        throw new APIError("UNAUTHORIZED");
                    }
                    const user = session.user;

                    await ctx.context.adapter.update({
                        model: "user",
                        where: [{ field: "id", value: user.id }],
                        update: {
                            status: "active",
                            deletedAt: null,
                        },
                    });

                    // Remove from blockedIdentifier if exists
                    if (user.email) {
                        const hash = await hashIdentifier(user.email);
                        try {
                            await ctx.context.adapter.delete?.({
                                model: "blockedIdentifier",
                                where: [
                                    { field: "identifierHash", value: hash },
                                    { field: "type", value: "email" }
                                ]
                            });
                        } catch (e) {
                            // ignore
                        }

                        if (options?.secondaryStorage) {
                            await options.secondaryStorage.delete(`blocked-email:${hash}`);
                        }
                    }

                    return ctx.json({
                        message: "Account restored successfully.",
                    });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
};
