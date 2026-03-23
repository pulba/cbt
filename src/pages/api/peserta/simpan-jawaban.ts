import type { APIRoute } from "astro";
import { db } from "../../../db";
import { testQuestions, testQuestionAnswers, testUsers } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from 'fs';

function appendLog(msg: string) {
    try {
        fs.appendFileSync('C:/tmp/simpan_log.txt', new Date().toISOString() + ' - ' + msg + '\n');
    } catch(e) {}
}

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || user.role !== "student") {
            appendLog(`Auth failed: user is ${JSON.stringify(user)}`);
            return new Response(JSON.stringify({ status: 0, message: "Unauthorized" }), { status: 401 });
        }

        const body = await request.json();
        appendLog(`Request body: ${JSON.stringify(body)}`);

        const action = String(body?.action || "");
        const testQuestionId = Number(body?.testQuestionId);
        const isDoubtful = !!body?.isDoubtful;
        const answerId = body?.answerId != null ? Number(body.answerId) : null;

        if (!action || !Number.isInteger(testQuestionId) || testQuestionId <= 0) {
            appendLog(`Invalid payload: action=${action}, testQuestionId=${testQuestionId}`);
            return new Response(JSON.stringify({ status: 0, message: "Aksi atau ID Pertanyaan tidak valid" }), { status: 400 });
        }

        // === OWNERSHIP CHECK (ANTI-IDOR) ===
        // Verify that this question belongs to the current user's session
        const qRows = await db
            .select({
                userId: testUsers.userId
            })
            .from(testQuestions)
            .innerJoin(testUsers, eq(testQuestions.testUserId, testUsers.id))
            .where(eq(testQuestions.id, testQuestionId))
            .limit(1);

        if (!qRows.length) {
            appendLog(`Question not found: ${testQuestionId}`);
            return new Response(JSON.stringify({ status: 0, message: "Soal tidak ditemukan" }), { status: 404 });
        }

        const ownerId = qRows[0].userId;
        if (ownerId == null || String(ownerId) !== String(user.id)) {
            appendLog(`IDOR attempt: ownerId=${ownerId}, userId=${user.id}`);
            return new Response(
                JSON.stringify({ status: 0, message: "Forbidden: bukan soal milik peserta ini" }),
                { status: 403 }
            );
        }

        if (action === "flag") {
            await db
                .update(testQuestions)
                .set({ isDoubtful })
                .where(eq(testQuestions.id, testQuestionId))
                .run();

            appendLog(`flag update SUCCESS for ${testQuestionId}, isDoubtful=${isDoubtful}`);
            return new Response(JSON.stringify({ status: 1 }));
        }

        if (action === "save_text") {
            const answerText = String(body?.answerText || "");
            await db
                .update(testQuestions)
                .set({ answerText, isAnswered: true })
                .where(eq(testQuestions.id, testQuestionId))
                .run();

            appendLog(`save_text SUCCESS for ${testQuestionId}`);
            return new Response(JSON.stringify({ status: 1 }));
        }

        if (action === "answer") {
            if (!answerId || !Number.isInteger(answerId) || answerId <= 0) {
                return new Response(JSON.stringify({ status: 0, message: "answerId tidak valid" }), { status: 400 });
            }

            // Reset semua opsi jawaban soal ini
            await db
                .update(testQuestionAnswers)
                .set({ isSelected: false })
                .where(eq(testQuestionAnswers.testQuestionId, testQuestionId))
                .run();

            // Set jawaban terpilih
            await db
                .update(testQuestionAnswers)
                .set({ isSelected: true })
                .where(
                    and(
                        eq(testQuestionAnswers.testQuestionId, testQuestionId),
                        eq(testQuestionAnswers.answerId, answerId)
                    )
                )
                .run();
                
            // Tandai soal sudah dijawab
            await db
                .update(testQuestions)
                .set({ isAnswered: true })
                .where(eq(testQuestions.id, testQuestionId))
                .run();

            appendLog(`answer update SUCCESS for ${testQuestionId}, ans=${answerId}`);
            return new Response(JSON.stringify({ status: 1 }));
        }

        appendLog(`Invalid action: ${action}`);
        return new Response(JSON.stringify({ status: 0, message: "Tindakan tidak valid" }), { status: 400 });

    } catch (error: any) {
        appendLog(`CATCH ERROR: ${error.message} \n ${error.stack}`);
        console.error("Save Answer Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Internal server error" }), { status: 500 });
    }
};
