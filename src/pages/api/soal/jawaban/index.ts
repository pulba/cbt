import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { questionAnswers } from "../../../../db/schema";
import { eq, inArray } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const questionId = url.searchParams.get("questionId");

        if (!questionId) {
            return new Response(JSON.stringify({ success: false, error: "Question ID tidak ditemukan" }), { status: 400 });
        }

        const data = await db.select().from(questionAnswers).where(eq(questionAnswers.questionId, parseInt(questionId))).all();

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
        const { questionId, text, isCorrect, audio } = body;

        if (!questionId || !text) {
            return new Response(JSON.stringify({ success: false, error: "Question ID dan Teks Jawaban wajib diisi" }), { status: 400 });
        }

        // If this answer is set as correct, and we only allow one correct answer per question,
        // we might want to update all other answers to isCorrect = false. 
        // For standard CBT, usually only one is correct (unless it's a multiple-select type, but let's assume single-choice PG here)
        if (isCorrect) {
            await db.update(questionAnswers).set({ isCorrect: false }).where(eq(questionAnswers.questionId, parseInt(questionId)));
        }

        const result = await db.insert(questionAnswers).values({
            questionId: parseInt(questionId),
            text,
            audio: audio || null,
            isCorrect: isCorrect ? true : false
        }).returning();

        return new Response(JSON.stringify({ success: true, data: result[0] }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, questionId, text, isCorrect, audio } = body;

        if (!id || !questionId || !text) {
            return new Response(JSON.stringify({ success: false, error: "ID, Question ID, dan Teks Jawaban wajib diisi" }), { status: 400 });
        }

        if (isCorrect) {
            await db.update(questionAnswers).set({ isCorrect: false }).where(eq(questionAnswers.questionId, parseInt(questionId)));
        }

        const updateData: any = {
            text,
            isCorrect: isCorrect ? true : false
        };

        if (audio !== undefined) {
            updateData.audio = audio;
        }

        const result = await db.update(questionAnswers)
            .set(updateData)
            .where(eq(questionAnswers.id, parseInt(id)))
            .returning();

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
            return new Response(JSON.stringify({ success: false, error: "ID wajib dikirim" }), { status: 400 });
        }

        await db.delete(questionAnswers).where(eq(questionAnswers.id, parseInt(id)));

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};

export const PATCH: APIRoute = async ({ request }) => {
    // Specialized route just to toggle the "isCorrect" flag quickly
    try {
        const body = await request.json();
        const { id, questionId } = body;

        if (!id || !questionId) {
            return new Response(JSON.stringify({ success: false, error: "ID dan Question ID wajib dikirim" }), { status: 400 });
        }

        // Set all to false first
        await db.update(questionAnswers).set({ isCorrect: false }).where(eq(questionAnswers.questionId, parseInt(questionId)));

        // Set the targeted one to true
        await db.update(questionAnswers).set({ isCorrect: true }).where(eq(questionAnswers.id, parseInt(id)));

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
