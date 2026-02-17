/**
 * Hashes a string using SHA-256.
 * Uses Web Crypto API which is available in Node.js, Bun, and Browsers.
 */
export async function hashIdentifier(identifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(identifier.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
