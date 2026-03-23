import type { APIRoute } from "astro";
import { db } from "../../../db";
import { testTokens } from "../../../db/schema";
import { eq } from "drizzle-orm";

// POST: Generate New Token
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { testId, lifetimeMinutes, customToken } = body;

        let finalToken = customToken;

        if (!finalToken || finalToken.trim() === "") {
            // Generate Random 6 Chars (Uppercase Alphanumeric)
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            finalToken = '';
            for (let i = 0; i < 6; i++) {
                finalToken += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } else {
            // Clean up custom token
            finalToken = finalToken.toUpperCase().replace(/\s+/g, '');
        }

        if (!testId || !lifetimeMinutes) {
            return new Response(JSON.stringify({ status: 0, message: "Parameter Ujian atau Waktu Aktif tidak lengkap" }), { status: 400 });
        }

        // Check if token already exists (tokens must be UNIQUE)
        const check = await db.select().from(testTokens).where(eq(testTokens.token, finalToken)).get();
        if (check) {
            return new Response(JSON.stringify({
                status: 0,
                message: "Token/PIN tersebut sudah ada di database dan masih aktif. Silakan gunakan kombinasi PIN lain."
            }), { status: 400 });
        }

        // Insert Token
        await db.insert(testTokens).values({
            testId: parseInt(testId),
            token: finalToken,
            lifetimeMinutes: parseInt(lifetimeMinutes),
        });

        return new Response(JSON.stringify({ status: 1, message: "Sukses Generate Token" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Token Generate Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Terjadi kesalahan server saat membuat token." }), { status: 500 });
    }
};

// DELETE: Revoke Token
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const { id } = await request.json();

        if (!id) {
            return new Response(JSON.stringify({ status: 0, message: "ID Token diperlukan" }), { status: 400 });
        }

        await db.delete(testTokens).where(eq(testTokens.id, id));

        return new Response(JSON.stringify({ status: 1, message: "Token berhasil dicabut" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Delete Token Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Gagal mencabut token." }), { status: 500 });
    }
};
