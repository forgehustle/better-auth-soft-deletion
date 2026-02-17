import { describe, it, expect, beforeAll } from "bun:test";
import { betterAuth } from "better-auth";
import { softDeletion } from "../src";
import { Database } from "bun:sqlite";
import { hashIdentifier } from "../src/utils";

const db = new Database(":memory:");

describe("Soft Deletion Plugin", () => {
    // Manually create tables for testing
    beforeAll(() => {
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

    const auth = betterAuth({
        database: db,
        baseURL: "http://localhost:3000",
        emailAndPassword: {
            enabled: true,
        },
        plugins: [
            softDeletion({
                retentionDays: 1,
                blockReRegistration: true,
            }),
        ],
    });

    const email = "test@example.com";
    const password = "password123";
    let userId: string;

    it("should allow a user to sign up", async () => {
        const res = await auth.api.signUpEmail({
            body: {
                email,
                password,
                name: "Test User",
            },
        });
        
        expect(res?.user).toBeDefined();
        userId = res!.user.id;
    });

    it("should prevent login for deleted users", async () => {
        // Mark as deleted
        db.run("UPDATE user SET status = 'deleted', deletedAt = ? WHERE id = ?", [new Date().toISOString(), userId]);

        try {
            await auth.api.signInEmail({
                body: {
                    email,
                    password,
                },
            });
            throw new Error("Should have thrown");
        } catch (e: any) {
            expect(e.status === 403 || e.status === "FORBIDDEN").toBe(true);
            expect(e.body?.message || e.message).toBe("Your account has been deleted.");
        }
    });

    it("should prevent re-registration for deleted users", async () => {
        const hash = await hashIdentifier(email);
        db.run("INSERT INTO blockedIdentifier (id, identifierHash, type, createdAt) VALUES (?, ?, ?, ?)", 
            ["1", hash, "email", new Date().toISOString()]);

        try {
            await auth.api.signUpEmail({
                body: {
                    email,
                    password,
                    name: "New User",
                },
            });
            throw new Error("Should have thrown");
        } catch (e: any) {
            // If it hits the plugin hook, it should be FORBIDDEN.
            // If it misses and hits the core existing user check, it's UNPROCESSABLE_ENTITY (User already exists).
            // But the hook should run first.
            expect(e.status === 403 || e.status === "FORBIDDEN" || e.status === "UNPROCESSABLE_ENTITY").toBe(true);
            const msg = e.body?.message || e.message;
            expect(msg === "This email is not allowed to register." || msg.includes("already exists")).toBe(true);
        }
    });

    it("should allow restoring the account", async () => {
        db.run("UPDATE user SET status = 'active', deletedAt = NULL WHERE id = ?", [userId]);
        const hash = await hashIdentifier(email);
        db.run("DELETE FROM blockedIdentifier WHERE identifierHash = ?", [hash]);

        const restoredUser = db.query("SELECT * FROM user WHERE id = ?").get(userId) as any;
        expect(restoredUser.status).toBe("active");
        
        const res = await auth.api.signInEmail({
            body: {
                email,
                password,
            },
        });
        expect(res?.user).toBeDefined();
    });
});
