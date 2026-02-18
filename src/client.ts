import type { BetterAuthClientPlugin } from "better-auth/client";
import type { RestoreAccountInput, RestoreAccountSuccess } from "./types";

type ClientFetch = (
    path: string,
    init: {
        method: "POST";
        body: RestoreAccountInput;
    }
) => Promise<unknown>;

type SoftDeletionServerPluginShape = {
    id: "SoftDeletion";
    schema: {
        user: {
            fields: {
                status: {
                    type: "string";
                    defaultValue: string;
                };
                deletedAt: {
                    type: "date";
                    required: false;
                };
            };
        };
        blockedIdentifier: {
            fields: {
                identifierHash: {
                    type: "string";
                    required: true;
                };
                type: {
                    type: "string";
                    required: true;
                };
                expiresAt: {
                    type: "date";
                    required: false;
                };
            };
        };
    };
    endpoints: {};
};

export const softDeletionClient = () => {
    return {
        id: "SoftDeletion",
        $InferServerPlugin: {} as SoftDeletionServerPluginShape,
        getActions: ($fetch: ClientFetch) => ({
            restoreAccount: async (data: RestoreAccountInput) => {
                const res = await $fetch("/soft-deletion/restore", {
                    method: "POST",
                    body: data,
                });
                return res as { data: RestoreAccountSuccess; error: unknown };
            },
        }),
    } satisfies BetterAuthClientPlugin;
};
