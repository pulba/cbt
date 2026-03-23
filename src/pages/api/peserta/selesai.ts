// api/peserta/selesai.ts
import type { APIRoute } from "astro";
import { db } from "../../../db";
import { tests, testUsers, testQuestions, testQuestionAnswers, questionAnswers } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

function redirect(path: string) {
    return new Response(null, {
        status: 302,
        headers: { Location: path }
    });
}

export const GET: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || user.role !== 'student') {
            return redirect("/siswa/ujian");
        }

        const url = new URL(request.url);
        const sessionId = url.searchParams.get("sessionId");

        if (!sessionId) {
            return redirect("/siswa/ujian");
        }

        const session = await db.select().from(testUsers).where(
            and(
                eq(testUsers.id, parseInt(sessionId)),
                eq(testUsers.userId, user.id!)
            )
        ).get();

        if (!session) {
            return redirect("/siswa/ujian");
        }

        // Only process if not already finished
        if (session.status !== 4) {
            const testData = await db.select().from(tests).where(eq(tests.id, session.testId!)).get();

            // 1. Fetch ALL selected answers for this session in ONE query
            const allSelectedAnswers = await db.select({
                testQuestionId: testQuestionAnswers.testQuestionId,
                isCorrect: questionAnswers.isCorrect,
            })
            .from(testQuestionAnswers)
            .innerJoin(questionAnswers, eq(testQuestionAnswers.answerId, questionAnswers.id))
            .innerJoin(testQuestions, eq(testQuestionAnswers.testQuestionId, testQuestions.id))
            .where(
                and(
                    eq(testQuestions.testUserId, session.id),
                    eq(testQuestionAnswers.isSelected, true)
                )
            ).all();

            // 2. Fetch all questions to ensure we cover unanswered ones
            const sessionQuestions = await db.select().from(testQuestions).where(eq(testQuestions.testUserId, session.id)).all();

            const scoreRight = testData?.scoreRight ?? 1;
            const scoreWrong = testData?.scoreWrong ?? 0;
            const scoreUnanswered = testData?.scoreUnanswered ?? 0;

            const batchOps: any[] = sessionQuestions.map(q => {
                const answers = allSelectedAnswers.filter(a => a.testQuestionId === q.id);
                let score = 0;
                let isAnswered = false;
                
                if (answers.length > 0) {
                    isAnswered = true;
                    const isCorrect = answers.some(a => a.isCorrect === true);
                    score = isCorrect ? scoreRight : scoreWrong;
                } else if (q.answerText && q.answerText.trim() !== '') {
                    isAnswered = true;
                    score = scoreUnanswered; // Default for text questions until manual grade
                } else {
                    score = scoreUnanswered;
                }
                
                return db.update(testQuestions).set({ score, isAnswered }).where(eq(testQuestions.id, q.id));
            });

            // Add the session status update to the batch
            batchOps.push(
                db.update(testUsers).set({
                    status: 4,  // 4 = finished
                }).where(eq(testUsers.id, session.id))
            );

            // 4. Execute all at once
            // @ts-ignore - drizzle-orm libsql batch
            await db.batch(batchOps);
        }

        return redirect(`/siswa/ujian?msg=success`);

    } catch (error: any) {
        console.error("Test Submission Error:", error);
        return redirect(`/siswa/ujian?msg=error`);
    }
};
