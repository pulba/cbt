import type { APIRoute } from "astro";
import { db } from "../../../db";
import { userGroups, users, testGroups } from "../../../db/schema";
import { eq, ne, and, sql } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const search = url.searchParams.get("search") || "";

        // Raw SQL for left join to count users
        let query = db
            .select({
                id: userGroups.id,
                name: userGroups.name,
                description: userGroups.description,
                studentCount: sql<number>`count(${users.id})`.as('studentCount')
            })
            .from(userGroups)
            .leftJoin(users, eq(userGroups.id, users.groupId))
            .groupBy(userGroups.id);

        if (search) {
            query = query.where(sql`lower(${userGroups.name}) like lower(${'%' + search + '%'})`) as any;
        }

        const data = await query.all();

        return new Response(JSON.stringify({ success: true, data }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { name, description } = body;

        if (!name) {
            return new Response(JSON.stringify({ success: false, error: "Nama grup wajib diisi" }), { status: 400 });
        }

        // Check if name already exists
        const existing = await db.select().from(userGroups).where(eq(userGroups.name, name)).get();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Nama grup sudah digunakan" }), { status: 400 });
        }

        const result = await db.insert(userGroups).values({ name, description }).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, name, description } = body;

        if (!id || !name) {
            return new Response(JSON.stringify({ success: false, error: "ID dan Nama grup wajib diisi" }), { status: 400 });
        }

        // Check if name already exists for OTHER groups
        const existing = await db.select().from(userGroups).where(and(eq(userGroups.name, name), ne(userGroups.id, id))).get();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Nama grup sudah digunakan oleh grup lain" }), { status: 400 });
        }

        const result = await db.update(userGroups).set({ name, description }).where(eq(userGroups.id, id)).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) {
            return new Response(JSON.stringify({ success: false, error: "ID grup wajib diisi" }), { status: 400 });
        }

        // Check if group is linked to any active tests (testGroups)
        const linkedTests = await db.select().from(testGroups).where(eq(testGroups.groupId, id)).get();
        if (linkedTests) {
            return new Response(JSON.stringify({ success: false, error: "Grup tidak dapat dihapus karena masih terdaftar dalam Jadwal Ujian." }), { status: 400 });
        }

        // Also check if there are students in this group
        const linkedStudents = await db.select().from(users).where(eq(users.groupId, id)).get();
        if (linkedStudents) {
            return new Response(JSON.stringify({ success: false, error: "Grup tidak dapat dihapus karena masih memiliki anggota siswa. Harap pindahkan/hapus siswa terlebih dahulu." }), { status: 400 });
        }

        await db.delete(userGroups).where(eq(userGroups.id, id)).run();

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
