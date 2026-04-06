import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { essayConfigs, questions } from "../../../../db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/soal/essay-config?questionId=X
 * Returns essay config for a specific question
 */
export const GET: APIRoute = async ({ url }) => {
    try {
        const questionId = url.searchParams.get("questionId");
        if (!questionId) {
            return new Response(JSON.stringify({ success: false, error: "questionId required" }), { status: 400 });
        }

        const config = await db
            .select()
            .from(essayConfigs)
            .where(eq(essayConfigs.questionId, parseInt(questionId)))
            .get();

        if (!config) {
            return new Response(JSON.stringify({ success: true, data: null }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    ...config,
                    keywords: JSON.parse(config.keywords ?? "[]"),
                },
            }),
            { headers: { "Content-Type": "application/json" } }
        );
    } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
};

/**
 * POST /api/soal/essay-config
 * Body: { questionId, correctAnswer, keywords: [{word, score, synonyms?}], gradingMode, maxScore }
 * Creates or updates essay config
 */
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { questionId, correctAnswer, keywords, gradingMode, maxScore } = body;

        if (!questionId) {
            return new Response(JSON.stringify({ success: false, error: "questionId required" }), { status: 400 });
        }

        // Verify question exists
        const question = await db
            .select({ id: questions.id, type: questions.type })
            .from(questions)
            .where(eq(questions.id, parseInt(questionId)))
            .get();

        if (!question) {
            return new Response(JSON.stringify({ success: false, error: "Soal tidak ditemukan" }), { status: 404 });
        }

        if (question.type === 1) {
            return new Response(
                JSON.stringify({ success: false, error: "Konfigurasi esai hanya untuk soal type Esai atau Jawaban Singkat" }),
                { status: 400 }
            );
        }

        const keywordsJson = JSON.stringify(Array.isArray(keywords) ? keywords : []);
        const validModes = ["keyword", "manual", "hybrid"];
        const mode = validModes.includes(gradingMode) ? gradingMode : "manual";

        // Upsert — check if exists
        const existing = await db
            .select({ id: essayConfigs.id })
            .from(essayConfigs)
            .where(eq(essayConfigs.questionId, parseInt(questionId)))
            .get();

        if (existing) {
            await db
                .update(essayConfigs)
                .set({
                    correctAnswer: correctAnswer || null,
                    keywords: keywordsJson,
                    gradingMode: mode,
                    maxScore: maxScore ? parseFloat(maxScore) : 100,
                })
                .where(eq(essayConfigs.questionId, parseInt(questionId)));

            return new Response(JSON.stringify({ success: true, message: "Konfigurasi esai diperbarui" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            const result = await db
                .insert(essayConfigs)
                .values({
                    questionId: parseInt(questionId),
                    correctAnswer: correctAnswer || null,
                    keywords: keywordsJson,
                    gradingMode: mode,
                    maxScore: maxScore ? parseFloat(maxScore) : 100,
                })
                .returning();

            return new Response(JSON.stringify({ success: true, data: result[0] }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
            });
        }
    } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
};

/**
 * DELETE /api/soal/essay-config?questionId=X
 */
export const DELETE: APIRoute = async ({ url }) => {
    try {
        const questionId = url.searchParams.get("questionId");
        if (!questionId) {
            return new Response(JSON.stringify({ success: false, error: "questionId required" }), { status: 400 });
        }

        await db.delete(essayConfigs).where(eq(essayConfigs.questionId, parseInt(questionId)));

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
};
