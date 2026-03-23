import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { questions, testQuestions, questionAnswers } from "../../../../db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const topicId = url.searchParams.get("topicId");

        if (!topicId) {
            return new Response(JSON.stringify({ success: false, error: "Topik ID tidak ditemukan" }), { status: 400 });
        }

        const data = await db.select().from(questions).where(eq(questions.topicId, parseInt(topicId))).all();

        return new Response(JSON.stringify({
            success: true,
            data
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
        const { topicId, type, text, audio, audioPlayLimit, difficulty, isActive } = body;

        if (!topicId || !type || !text) {
            return new Response(JSON.stringify({ success: false, error: "Topik, Tipe, dan Teks Soal wajib diisi" }), { status: 400 });
        }

        const result = await db.insert(questions).values({
            topicId: parseInt(topicId),
            type: parseInt(type),
            text,
            audio: audio || null,
            audioPlayLimit: audioPlayLimit ? parseInt(audioPlayLimit) : 0,
            difficulty: difficulty ? parseInt(difficulty) : 1,
            isActive: isActive !== undefined ? isActive : true
        }).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, topicId, type, text, audio, audioPlayLimit, difficulty, isActive } = body;

        if (!id || !topicId || !type || !text) {
            return new Response(JSON.stringify({ success: false, error: "ID, Topik, Tipe, dan Teks Soal wajib diisi" }), { status: 400 });
        }

        const updateData: any = {
            topicId: parseInt(topicId),
            type: parseInt(type),
            text,
            audioPlayLimit: audioPlayLimit ? parseInt(audioPlayLimit) : 0,
            difficulty: difficulty ? parseInt(difficulty) : 1,
            isActive: isActive !== undefined ? isActive : true
        };

        // Only update audio if provided (don't overwrite with null if not sent during an edit)
        if (audio !== undefined) {
            updateData.audio = audio;
        }

        const result = await db.update(questions)
            .set(updateData)
            .where(eq(questions.id, parseInt(id)))
            .returning();

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

        // Validate if question is already being used in an active exam
        for (const id of ids) {
            const usage = await db.select().from(testQuestions).where(eq(testQuestions.questionId, id)).get();
            if (usage) {
                return new Response(JSON.stringify({
                    success: false,
                    error: `Gagal menghapus: Salah satu soal sedang dikerjakan/digunakan dalam ujian aktif.`
                }), { status: 400 });
            }
        }

        // Delete associated answers first (foreign key constraint handling)
        await db.delete(questionAnswers).where(inArray(questionAnswers.questionId, ids));

        // Delete questions
        await db.delete(questions).where(inArray(questions.id, ids));

        return new Response(JSON.stringify({ success: true, deletedCount: ids.length }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
