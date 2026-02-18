import type { BetterAuthClientPlugin } from "better-auth/client";
import type { softDeletion } from "./index";
import type { RestoreAccountInput, RestoreAccountSuccess } from "./types";

type ClientFetch = (
    path: string,
    init: {
        method: "POST";
        body: RestoreAccountInput;
    }
) => Promise<unknown>;

export const softDeletionClient = () => {
    return {
        id: "SoftDeletion",
        $InferServerPlugin: {} as ReturnType<typeof softDeletion>,
        getActions: ($fetch: ClientFetch) => ({
            restoreAccount: async (data: RestoreAccountInput) => {
                const res = await $fetch("/SoftDeletion/restore", {
                    method: "POST",
                    body: data,
                });
                return res as { data: RestoreAccountSuccess; error: unknown };
            },
        }),
    } satisfies BetterAuthClientPlugin;
};
