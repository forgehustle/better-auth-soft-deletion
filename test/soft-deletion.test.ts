import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { betterAuth } from "better-auth"; // For types and APIError
import { softDeletion } from "../src";
import { Database } from "bun:sqlite";
import { hashIdentifier } from "../src/utils";
import { APIError } from "better-auth";

const db = new Database(":memory:");

// Mock for Better Auth's internal adapter and password verifier
const mockAdapter = {
    // Implement only methods used in the plugin
    findOne: (args: any) => {
        if (args.model === "user") {
            // Find user by email
            const user = db.query("SELECT * FROM user WHERE email = ?").get(args.where[0].value) as any;
            return Promise.resolve(user);
        }
        if (args.model === "account") {
            // Find by userId and providerId
            if (args.where.length === 2 && args.where[0].field === "userId" && args.where[1].field === "providerId") {
                const account = db.query("SELECT * FROM account WHERE userId = ? AND providerId = ?")
                                   .get(args.where[0].value, args.where[1].value) as any;
                return Promise.resolve(account);
            }
            return Promise.resolve(null);
        }
        if (args.model === "blockedIdentifier") {
            // Find by identifierHash and type
            const blocked = db.query("SELECT * FROM blockedIdentifier WHERE identifierHash = ? AND type = ?")
                              .get(args.where[0].value, args.where[1].value) as any;
            return Promise.resolve(blocked);
        }
        return Promise.resolve(null);
    },
    update: (args: any) => {
        if (args.model === "user") {
            const { status, deletedAt } = args.update;
            db.run("UPDATE user SET status = ?, deletedAt = ? WHERE id = ?", [status, deletedAt?.toISOString(), args.where[0].value]);
            return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
    },
    create: (args: any) => {
        if (args.model === "blockedIdentifier") {
            const { id, identifierHash, type, expiresAt, createdAt } = args.data;
            db.run("INSERT INTO blockedIdentifier (id, identifierHash, type, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)",
                [id, identifierHash, type, expiresAt?.toISOString(), createdAt.toISOString()]);
            return Promise.resolve({ ...args.data });
        }
        return Promise.resolve({ success: true });
    },
    delete: (args: any) => {
        if (args.model === "blockedIdentifier") {
            const identifierHash = args.where.find((w: any) => w.field === "identifierHash")?.value;
            db.run("DELETE FROM blockedIdentifier WHERE identifierHash = ?", [identifierHash]);
            return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
    }
};

const mockPasswordService = {
    hash: async (password: string) => `hashed_${password}`, // Simple mock hash
    verify: async (password: string, hashedPassword: string) => `hashed_${password}` === hashedPassword,
};

describe("Soft Deletion Plugin", () => {
    let authPlugin: ReturnType<typeof softDeletion>; // Get the plugin instance
    let pluginInitOptions: any; // Store the options returned by plugin.init()

    // Initialize the plugin once
    beforeAll(() => {
        authPlugin = softDeletion({
            retentionDays: 1,
            blockReRegistration: true,
        });
        pluginInitOptions = authPlugin.init?.(); // Get the object returned by init
    });

    // Clear and re-create tables before each test to ensure isolation
    beforeEach(() => {
        db.run(`DROP TABLE IF EXISTS user`);
        db.run(`DROP TABLE IF EXISTS session`);
        db.run(`DROP TABLE IF EXISTS account`);
        db.run(`DROP TABLE IF EXISTS blockedIdentifier`);

        db.run(`CREATE TABLE IF NOT EXISTS user (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            emailVerified BOOLEAN NOT NULL DEFAULT 0,
            image TEXT,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            status TEXT DEFAULT 'active',
            deletedAt DATETIME
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS session (
            id TEXT PRIMARY KEY,
            expiresAt DATETIME NOT NULL,
            token TEXT NOT NULL UNIQUE,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            ipAddress TEXT,
            userAgent TEXT,
            userId TEXT NOT NULL REFERENCES user(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS account (
            id TEXT PRIMARY KEY,
            accountId TEXT NOT NULL,
            providerId TEXT NOT NULL,
            userId TEXT NOT NULL REFERENCES user(id),
            accessToken TEXT,
            refreshToken TEXT,
            idToken TEXT,
            expiresAt DATETIME,
            password TEXT,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS blockedIdentifier (
            id TEXT PRIMARY KEY,
            identifierHash TEXT NOT NULL,
            type TEXT NOT NULL,
            expiresAt DATETIME,
            createdAt DATETIME NOT NULL
        )`);
    });


    it("should allow a user to sign up", async () => {
        const email = "signup@example.com";
        const password = "password123";
        const hashedPassword = `hashed_${password}`;
        const userId = "user_signup_1";

        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Signup User", email, 0, new Date().toISOString(), new Date().toISOString(), "active"]);
        db.run(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["account_signup_1", "account_signup_1", "credential", userId, hashedPassword, new Date().toISOString(), new Date().toISOString()]);
        
        const user = db.query("SELECT * FROM user WHERE id = ?").get(userId) as any;
        expect(user).toBeDefined();
        expect(user.email).toBe(email);
        const account = db.query("SELECT * FROM account WHERE userId = ?").get(userId) as any;
        expect(account).toBeDefined();
        expect(account.password).toBe(hashedPassword);
    });

    it("should require password confirmation for deletion", async () => {
        const email = "delete_confirm@example.com";
        const password = "password123";
        const hashedPassword = `hashed_${password}`;
        const userId = "user_delete_confirm_1";

        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Confirm User", email, 0, new Date().toISOString(), new Date().toISOString(), "active"]);
        db.run(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["account_delete_confirm_1", "account_delete_confirm_1", "credential", userId, hashedPassword, new Date().toISOString(), new Date().toISOString()]);

        const mockCtx = {
            path: "/delete-user",
            body: { userId }, // No password provided
            context: {
                session: { user: { id: userId } },
                adapter: mockAdapter,
                password: mockPasswordService,
            }
        };

        try {
            await authPlugin.hooks?.before?.[0].handler(mockCtx as any); 
            throw new Error("Should have thrown BAD_REQUEST for missing password");
        } catch (e: any) {
            expect(e).toBeInstanceOf(APIError);
            expect(e.status).toBe("BAD_REQUEST");
            expect(e.message).toBe("Password confirmation is required to delete your account.");
        }
    });

    it("should soft delete a user after valid password confirmation", async () => {
        const email = "soft_delete@example.com";
        const password = "password123";
        const hashedPassword = `hashed_${password}`;
        const userId = "user_soft_delete_1";

        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Soft Delete User", email, 0, new Date().toISOString(), new Date().toISOString(), "active"]);
        db.run(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["account_soft_delete_1", "account_soft_delete_1", "credential", userId, hashedPassword, new Date().toISOString(), new Date().toISOString()]);

        const mockCtx = {
            path: "/delete-user",
            body: { userId, password }, // Correct password
            context: {
                session: { user: { id: userId } },
                adapter: mockAdapter,
                password: mockPasswordService,
            }
        };

        // Call the hook to perform password check
        await authPlugin.hooks?.before?.[0].handler(mockCtx as any); 

        // Now, trigger the databaseHooks.user.delete.before
        const deleteHookHandler = pluginInitOptions.options?.databaseHooks?.user?.delete?.before;
        expect(deleteHookHandler).toBeDefined();

        const hookResult = await deleteHookHandler!(
            { id: userId, email: email }, // User object passed to hook
            { adapter: mockAdapter, generateId: (len: number) => "mock_id_" + len } // ctx to hook
        );
        expect(hookResult).toBe(false); // Expect false to prevent hard deletion

        // Verify user still exists in DB but with deleted status
        const dbUser = db.query("SELECT * FROM user WHERE id = ?").get(userId) as any;
        expect(dbUser).toBeDefined();
        expect(dbUser.status).toBe("deleted");
        expect(dbUser.deletedAt).toBeDefined();

        // Verify blockedIdentifier entry
        const hash = await hashIdentifier(email);
        const blocked = db.query("SELECT * FROM blockedIdentifier WHERE identifierHash = ?").get(hash) as any;
        expect(blocked).toBeDefined();
        expect(blocked.type).toBe("email");
    });

    it("should prevent login for deleted users", async () => {
        const email = "login_deleted@example.com";
        const password = "password123";
        const userId = "user_login_deleted_1";

        // Manually create user and set status to deleted
        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Login User", email, 0, new Date().toISOString(), new Date().toISOString(), "deleted"]);
        
        const mockCtx = {
            path: "/sign-in/email",
            body: { email, password },
            context: {
                adapter: mockAdapter,
            }
        };

        try {
            // Call the sign-in hook handler directly
            await authPlugin.hooks?.before?.[1].handler(mockCtx as any); 
            throw new Error("Should have thrown FORBIDDEN");
        } catch (e: any) {
            expect(e).toBeInstanceOf(APIError);
            expect(e.status).toBe("FORBIDDEN");
            expect(e.message).toBe("Your account has been deleted.");
        }
    });

    it("should prevent re-registration for deleted users", async () => {
        const email = "re_register@example.com";
        const password = "password123";
        const userId = "user_re_register_1";

        // Manually create user, set status to deleted, and add to blockedIdentifier
        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Re-register User", email, 0, new Date().toISOString(), new Date().toISOString(), "deleted"]);
        const hash = await hashIdentifier(email);
        db.run("INSERT INTO blockedIdentifier (id, identifierHash, type, createdAt) VALUES (?, ?, ?, ?)", 
            ["blocked_id_1", hash, "email", new Date().toISOString()]);
        
        const mockCtx = {
            path: "/sign-up/email",
            body: { email, password: "anotherpassword" },
            context: {
                adapter: mockAdapter,
            }
        };

        try {
            // Call the sign-up hook handler directly
            await authPlugin.hooks?.before?.[2].handler(mockCtx as any); 
            throw new Error("Should have thrown FORBIDDEN for re-registration");
        } catch (e: any) {
            expect(e).toBeInstanceOf(APIError);
            expect(e.status).toBe("FORBIDDEN");
            expect(e.message).toBe("This email is not allowed to register.");
        }
    });

    it("should allow restoring the account", async () => {
        const email = "restore@example.com";
        const password = "password123";
        const hashedPassword = `hashed_${password}`;
        const userId = "user_restore_1";

        // Manually create user, set status to deleted, and add to blockedIdentifier
        db.run(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, "Restore User", email, 0, new Date().toISOString(), new Date().toISOString(), "deleted"]);
        db.run(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["account_restore_1", "account_restore_1", "credential", userId, hashedPassword, new Date().toISOString(), new Date().toISOString()]);
        const hash = await hashIdentifier(email);
        db.run("INSERT INTO blockedIdentifier (id, identifierHash, type, createdAt) VALUES (?, ?, ?, ?)", 
            ["blocked_restore_id", hash, "email", new Date().toISOString()]);

        const mockCtx = {
            context: {
                session: { user: { id: userId, email: email } },
                adapter: mockAdapter,
                generateId: (len: number) => "mock_restore_id_" + len,
                password: mockPasswordService,
            },
            json: (res: any) => res, // Mock json response function
        };

        // Call the restoreAccount endpoint handler directly
        const restoreHandler = authPlugin.endpoints?.restoreAccount;
        expect(restoreHandler).toBeDefined();

        const restoreRes = await restoreHandler!(mockCtx as any);
        expect(restoreRes?.message).toBe("Account restored successfully.");

        // Verify user status is active and blockedIdentifier removed
        const restoredUser = db.query("SELECT * FROM user WHERE id = ?").get(userId) as any;
        expect(restoredUser).toBeDefined(); 
        expect(restoredUser.status).toBe("active");
        expect(restoredUser.deletedAt).toBeNull();
        
        const blockedAfterRestore = db.query("SELECT * FROM blockedIdentifier WHERE identifierHash = ?").get(hash) as any;
        expect(blockedAfterRestore).toBeNull();
    });
});
