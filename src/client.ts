import type { BetterAuthClientPlugin } from "better-auth/client";
import type { softDeletion } from "./index";

export const softDeletionClient = () => {
    return {
        id: "SoftDeletion",
        $InferServerPlugin: {} as ReturnType<typeof softDeletion>,
        getActions: ($fetch: any) => ({
            restoreAccount: async () => {
                const res = await $fetch("/auth/SoftDeletion/restore", {
                    method: "POST",
                });
                return res as { data: { message: string }; error: any };
            },
            deleteUser: async (password: string) => {
                const res = await $fetch("/auth/delete-user", {
                    method: "POST",
                    body: { password }
                });
                return res as { data: { message: string }; error: any };
            },
        }),
    } satisfies BetterAuthClientPlugin;
};
