import type { APIRoute } from "astro";
import { db } from "../../../../db";
import {
    testQuestions,
    testUsers,
    tests,
    questions,
    essayConfigs,
    users,
    userGroups,
} from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/admin/koreksi-esai?testId=X
 * Returns list of essay questions needing grading for a test
 */
export const GET: APIRoute = async ({ url, locals }) => {
    try {
        const user = locals.user;
        if (!user || (user.role !== "admin" && user.role !== "guru")) {
            return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 });
        }

        const testId = url.searchParams.get("testId");
        if (!testId) {
            return new Response(JSON.stringify({ success: false, error: "testId required" }), { status: 400 });
        }

        // Get all sessions for this test
        const sessions = await db
            .select({
                sessionId: testUsers.id,
                userId: testUsers.userId,
                status: testUsers.status,
                firstName: users.firstName,
                username: users.username,
                groupName: userGroups.name,
            })
            .from(testUsers)
            .innerJoin(users, eq(testUsers.userId, users.id))
            .leftJoin(userGroups, eq(users.groupId, userGroups.id))
            .where(eq(testUsers.testId, parseInt(testId)))
            .orderBy(userGroups.name, users.firstName)
            .all();

        // For each session, get essay questions
        const result = [];

        for (const sess of sessions) {
            const essayQs = await db
                .select({
                    tqId: testQuestions.id,
                    orderIdx: testQuestions.orderIdx,
                    answerText: testQuestions.answerText,
                    score: testQuestions.score,
                    isAnswered: testQuestions.isAnswered,
                    essayScoreOverride: testQuestions.essayScoreOverride,
                    essayGradedBy: testQuestions.essayGradedBy,
                    essayNotes: testQuestions.essayNotes,
                    qId: questions.id,
                    qText: questions.text,
                    qType: questions.type,
                    correctAnswer: essayConfigs.correctAnswer,
                    keywords: essayConfigs.keywords,
                    gradingMode: essayConfigs.gradingMode,
                    maxScore: essayConfigs.maxScore,
                })
                .from(testQuestions)
                .innerJoin(questions, eq(testQuestions.questionId, questions.id))
                .leftJoin(essayConfigs, eq(testQuestions.questionId, essayConfigs.questionId))
                .where(
                    and(
                        eq(testQuestions.testUserId, sess.sessionId),
                        // Only type 2 (essay) or 3 (short answer)
                    )
                )
                .all();

            // Filter to only essay/short answer
            const essayOnly = essayQs.filter((q) => q.qType === 2 || q.qType === 3);
            if (essayOnly.length === 0) continue;

            const gradedCount = essayOnly.filter(
                (q) => q.essayGradedBy !== null || q.essayScoreOverride !== null
            ).length;

            result.push({
                ...sess,
                essayQuestions: essayOnly.map((q) => ({
                    ...q,
                    keywords: q.keywords ? JSON.parse(q.keywords) : [],
                })),
                gradedCount,
                totalEssay: essayOnly.length,
                isPending: gradedCount < essayOnly.length && sess.status === 4,
            });
        }

        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
};

/**
 * PATCH /api/admin/koreksi-esai
 * Body: { testQuestionId, score, notes }
 * Submit manual grade for one essay question
 */
export const PATCH: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || (user.role !== "admin" && user.role !== "guru")) {
            return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 });
        }

        const body = await request.json();
        const { testQuestionId, score, notes } = body;

        if (testQuestionId === undefined || score === undefined) {
            return new Response(JSON.stringify({ success: false, error: "testQuestionId dan score wajib diisi" }), {
                status: 400,
            });
        }

        const scoreVal = parseFloat(score);
        if (isNaN(scoreVal) || scoreVal < 0) {
            return new Response(JSON.stringify({ success: false, error: "Score tidak valid" }), { status: 400 });
        }

        await db
            .update(testQuestions)
            .set({
                essayScoreOverride: scoreVal,
                score: scoreVal, // also update the main score column
                essayGradedBy: user.id,
                essayGradedAt: new Date(),
                essayNotes: notes || null,
            })
            .where(eq(testQuestions.id, parseInt(testQuestionId)));

        return new Response(JSON.stringify({ success: true, message: "Nilai berhasil disimpan" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
};
