import type { APIRoute } from "astro";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { eq, inArray } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { ids } = body;

        // Reset massal jika array ids diberikan
        if (ids && Array.isArray(ids) && ids.length > 0) {
            await db.update(users).set({ isLogin: false }).where(inArray(users.id, ids)).run();
            return new Response(JSON.stringify({ success: true, message: `Berhasil mereset ${ids.length} peserta` }), { status: 200 });
        }

        // Atur agar payload single ID juga disupport (opsional)
        const { id } = body;
        if (id) {
            await db.update(users).set({ isLogin: false }).where(eq(users.id, id)).run();
            return new Response(JSON.stringify({ success: true, message: `Berhasil mereset 1 peserta` }), { status: 200 });
        }

        return new Response(JSON.stringify({ success: false, error: "ID Peserta tidak valid" }), { status: 400 });

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
