import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { topics, testTopicSets, questions, questionAnswers, testQuestions, essayConfigs } from "../../../../db/schema";
import { eq, like, inArray, sql } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const search = url.searchParams.get("search") || "";
        const limitStr = url.searchParams.get("limit") || "20";
        const pageStr = url.searchParams.get("page") || "1";

        const limit = parseInt(limitStr);
        const page = parseInt(pageStr);
        const offset = (page - 1) * limit;

        const baseQuery = db.select().from(topics);

        // Subquery or aggregation to count questions could be added here, 
        // but for simplicity we'll just return the topic data.
        let query;
        let countQuery;

        if (search) {
            query = baseQuery.where(like(topics.name, `%${search}%`)).limit(limit).offset(offset);
            countQuery = db.select({ count: sql<number>`count(*)` }).from(topics).where(like(topics.name, `%${search}%`));
        } else {
            query = baseQuery.limit(limit).offset(offset);
            countQuery = db.select({ count: sql<number>`count(*)` }).from(topics);
        }

        const data = await query.all();
        const totalResult = await countQuery.get();
        const total = totalResult?.count || 0;

        // Optionally, check testing usage flag if needed for UI
        // We'll calculate a flag `inUse` for each
        const inUseChecks = await Promise.all(data.map(async (t) => {
            const usage = await db.select().from(testTopicSets).where(eq(testTopicSets.topicId, t.id)).limit(1).get();
            return !!usage;
        }));

        const resultData = data.map((t, i) => ({
            ...t,
            inUse: inUseChecks[i]
        }));

        return new Response(JSON.stringify({
            success: true,
            data: resultData,
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
        const { name, description, status } = body;

        if (!name) {
            return new Response(JSON.stringify({ success: false, error: "Nama topik wajib diisi" }), { status: 400 });
        }

        // Check unique topic name
        const existing = await db.select().from(topics).where(eq(topics.name, name)).get();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Nama topik sudah digunakan" }), { status: 400 });
        }

        const result = await db.insert(topics).values({
            name,
            description: description || null,
            status: status !== undefined ? status : true
        }).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, name, description, status } = body;

        if (!id || !name) {
            return new Response(JSON.stringify({ success: false, error: "ID dan Nama topik wajib diisi" }), { status: 400 });
        }

        // Check unique topic name for *other* records
        const existing = await db.select().from(topics).where(
            sql`${topics.name} = ${name} AND ${topics.id} != ${id}`
        ).get();

        if (existing) {
            return new Response(JSON.stringify({ success: false, error: "Nama topik sudah digunakan oleh topik lain" }), { status: 400 });
        }

        const result = await db.update(topics).set({
            name,
            description: description || null,
            status: status !== undefined ? status : true
        }).where(eq(topics.id, id)).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { ids } = body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "ID Array wajib dikirim" }), { status: 400 });
        }

        // Validate if any topic is in use by testTopicSets
        // Prevent deletion if it's attached to any test configuration
        for (const id of ids) {
            const usage = await db.select().from(testTopicSets).where(eq(testTopicSets.topicId, id)).get();
            if (usage) {
                const topic = await db.select().from(topics).where(eq(topics.id, id)).get();
                return new Response(JSON.stringify({
                    success: false,
                    error: `Gagal menghapus: Topik "${topic?.name}" sedang digunakan dalam konfigurasi Ujian.`
                }), { status: 400 });
            }
        }

        // Find all questions belonging to these topics
        const relatedQuestions = await db.select({ id: questions.id }).from(questions).where(inArray(questions.topicId, ids)).all();
        const questionIds = relatedQuestions.map(q => q.id);

        if (questionIds.length > 0) {
            // Check if any question is actively locked in a test section
            const usage = await db.select().from(testQuestions).where(inArray(testQuestions.questionId, questionIds)).limit(1).get();
            if (usage) {
                return new Response(JSON.stringify({
                    success: false,
                    error: `Gagal menghapus: Salah satu soal di dalam Topik ini sedang dikerjakan atau digunakan dalam ujian aktif.`
                }), { status: 400 });
            }

            // Delete all question answers mapping to these questions
            await db.delete(questionAnswers).where(inArray(questionAnswers.questionId, questionIds));
            
            // Delete all essay configs mapping to these questions
            await db.delete(essayConfigs).where(inArray(essayConfigs.questionId, questionIds));
            
            // Delete the questions themselves
            await db.delete(questions).where(inArray(questions.id, questionIds));
        }

        await db.delete(topics).where(inArray(topics.id, ids));

        // Note: Future feature - ideally we also recursively delete physical folders 
        // /uploads/topik_[id] for all media here, but Node.js fs.rm operation 
        // should be done asynchronously if the folder exists.

        return new Response(JSON.stringify({ success: true, deletedCount: ids.length }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
