import type { BetterAuthClientPlugin } from "better-auth/client";
import type { softDeletion } from "./index";

export const softDeletionClient = () => {
    return {
        id: "soft-deletion",
        $InferServerPlugin: {} as ReturnType<typeof softDeletion>,
        getActions: ($fetch: any) => ({
            restoreAccount: async () => {
                const res = await $fetch("/soft-deletion/restore", {
                    method: "POST",
                });
                return res as { data: { message: string }; error: any };
            },
        }),
    } satisfies BetterAuthClientPlugin;
};
