import type { APIRoute } from "astro";
import { db } from "../../../db";
import { users, userGroups } from "../../../db/schema";
import { eq, like, inArray, and, ne, sql } from "drizzle-orm";
// @ts-ignore
import bcrypt from "bcryptjs";

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const search = url.searchParams.get("search") || "";
        const groupId = url.searchParams.get("groupId") || "";
        const limitStr = url.searchParams.get("limit") || "20";
        const pageStr = url.searchParams.get("page") || "1";

        const limit = parseInt(limitStr);
        const page = parseInt(pageStr);
        const offset = (page - 1) * limit;

        let conditions = [];

        if (search) {
            conditions.push(sql`(lower(${users.username}) like lower(${'%' + search + '%'}) or lower(${users.firstName}) like lower(${'%' + search + '%'}))`);
        }

        if (groupId) {
            conditions.push(eq(users.groupId, parseInt(groupId)));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Fetch paginated data
        const dataQuery = db
            .select({
                id: users.id,
                username: users.username,
                firstName: users.firstName,
                email: users.email,
                isLogin: users.isLogin,
                groupName: userGroups.name,
                groupId: users.groupId,
                // We'll return password to show on forms or clear-text on UI (which is bad practice usually, 
                // but the requirement says password saved clear-text to print cards easily? 
                // Ah, the txt says: "string password langsung di-insert apa adanya (bertipe clear-text, sengaja tidak di-enkripsi md5/bcrypt agar bisa dicetak di Kartu Ujian siswa nantinya)"
                password: users.password
            })
            .from(users)
            .leftJoin(userGroups, eq(users.groupId, userGroups.id));

        if (whereClause) {
            dataQuery.where(whereClause);
        }

        const data = await dataQuery.limit(limit).offset(offset).all();

        // Get total count
        const countQuery = db.select({ count: sql<number>`count(*)` }).from(users);
        if (whereClause) {
            countQuery.where(whereClause);
        }
        const totalResult = await countQuery.get();
        const total = totalResult?.count || 0;

        return new Response(JSON.stringify({
            success: true,
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { username, password, firstName, email, groupId, detail } = body;

        if (!username || !password || !firstName || !groupId) {
            return new Response(JSON.stringify({ success: false, error: "Username, Password, Nama, dan Grup wajib diisi" }), { status: 400 });
        }

        // Check unique username
        const existing = await db.select().from(users).where(eq(users.username, username)).get();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Username sudah digunakan oleh peserta lain" }), { status: 400 });
        }

        // Insert password as clear-text based on requirements for printing cards
        const result = await db.insert(users).values({
            username,
            password,
            firstName,
            email: email || null,
            groupId: parseInt(groupId),
            detail: detail || null
        }).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, username, password, firstName, email, groupId, detail } = body;

        if (!id || !username || !firstName || !groupId) {
            return new Response(JSON.stringify({ success: false, error: "ID, Username, Nama, dan Grup wajib diisi" }), { status: 400 });
        }

        // Check unique username excluding self
        const existing = await db.select().from(users).where(and(eq(users.username, username), ne(users.id, id))).get();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Username sudah digunakan oleh peserta lain" }), { status: 400 });
        }

        const updateData: any = {
            username,
            firstName,
            email: email || null,
            groupId: parseInt(groupId),
            detail: detail || null
        };

        if (password) {
            updateData.password = password;
        }

        const result = await db.update(users).set(updateData).where(eq(users.id, id)).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { ids } = body; // Array of IDs for mass delete

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "ID Array wajib dikirim" }), { status: 400 });
        }

        await db.delete(users).where(inArray(users.id, ids)).run();

        return new Response(JSON.stringify({ success: true, deletedCount: ids.length }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
