// api/peserta/selesai.ts
import type { APIRoute } from "astro";
import { db } from "../../../db";
import { tests, testUsers, testQuestions, testQuestionAnswers, questionAnswers, questions, essayConfigs, testTopicSets } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { autoGradeEssay } from "../../../lib/essay-scoring";
import type { Keyword } from "../../../lib/essay-scoring";

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

        // Fetch test data first (needed for redirect logic and scoring)
        const testData = await db.select().from(tests).where(eq(tests.id, session.testId!)).get();

        // Only process if not already finished
        if (session.status !== 4) {

            // 1. Fetch ALL selected answers for this session in ONE query
            const allSelectedAnswers = await db.select({
                testQuestionId: testQuestionAnswers.testQuestionId,
                answerId: testQuestionAnswers.answerId,
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

            const scoreRightGlobal = testData?.scoreRight ?? 1;
            const scoreWrongGlobal = testData?.scoreWrong ?? 0;
            const scoreUnanswered = testData?.scoreUnanswered ?? 0;
            const isTkaMode = testData?.mode === 'tka';

            // 3. Pre-fetch topic sets for overriden scores if in TKA mode
            const tkaTopicSets = isTkaMode ? await db.select().from(testTopicSets).where(eq(testTopicSets.testId, session.testId!)).all() : [];
            let parsedTkaScores: any = {};
            if (isTkaMode && testData?.tkaScoreConfig) {
                try { parsedTkaScores = JSON.parse(testData.tkaScoreConfig); } catch(e) {}
            }

            const batchOps: any[] = [];

            for (const q of sessionQuestions) {
                const answers = allSelectedAnswers.filter(a => a.testQuestionId === q.id);
                let score = 0;
                let isAnswered = false;
                let essayNotes: string | null = null;

                // Get question type and topic
                const qData = await db.select({ type: questions.type, topicId: questions.topicId })
                    .from(questions)
                    .where(eq(questions.id, q.questionId))
                    .get();

                const isEssay = qData?.type === 2 || qData?.type === 3;
                
                // Determine scoring weights for this specific question
                let qScoreRight = scoreRightGlobal;
                let qScoreWrong = scoreWrongGlobal;
                
                if (isTkaMode && qData) {
                    if (parsedTkaScores[qData.type] !== undefined) {
                        qScoreRight = parseFloat(parsedTkaScores[qData.type]);
                    }
                    const ts = tkaTopicSets.find(t => t.topicId === qData.topicId && t.questionType === qData.type);
                    if (ts) {
                        qScoreRight = ts.scoreRightOverride !== null ? ts.scoreRightOverride : qScoreRight;
                        qScoreWrong = ts.scoreWrongOverride !== null ? ts.scoreWrongOverride : qScoreWrong;
                    }
                }

                if (answers.length > 0 && qData?.type === 1) {
                    // Type 1: Standard Pilihan Ganda (Single correct)
                    isAnswered = true;
                    const isCorrect = answers.some(a => a.isCorrect === true);
                    score = isCorrect ? qScoreRight : qScoreWrong;
                } else if (qData?.type === 5 || qData?.type === 6) {
                    // Type 5 & 6: Pilihan Ganda Kompleks & Benar/Salah (Partial Scoring)
                    // Pilihan benar = +scoreRight. Pilihan salah = +scoreWrong (which is usually 0 or negative).
                    // Minimum score is 0.
                    const qAnswers = await db.select().from(questionAnswers).where(eq(questionAnswers.questionId, q.questionId)).all();
                    const selectedAnsIds = answers.map(a => a.answerId);
                    
                    if (selectedAnsIds.length > 0) isAnswered = true;

                    let partialScore = 0;
                    // Always use Partial Scoring based on selections for Ceklis & Benar/Salah
                    for (const selId of selectedAnsIds) {
                        const qa = qAnswers.find(x => x.id === selId);
                        if (qa) {
                            partialScore += qa.isCorrect ? qScoreRight : qScoreWrong;
                        }
                    }
                    if (isTkaMode) {
                        let maxPossible = 0;
                        if (qData?.type === 5) {
                            maxPossible = qAnswers.filter(a => a.isCorrect).length * qScoreRight;
                        } else if (qData?.type === 6) {
                            maxPossible = qAnswers.length * qScoreRight;
                        }
                        score = maxPossible > 0 ? (Math.max(0, partialScore) / maxPossible) * qScoreRight : 0;
                    } else {
                        score = Math.max(0, partialScore);
                    }
                } else if (isEssay && q.answerText && q.answerText.trim() !== '') {
                    isAnswered = true;
                    // Try auto-grading via essay config
                    const essayConfig = await db.select()
                        .from(essayConfigs)
                        .where(eq(essayConfigs.questionId, q.questionId))
                        .get();

                    if (essayConfig) {
                        const keywords: Keyword[] = JSON.parse(essayConfig.keywords ?? '[]');
                        // In TKA mode, always use hybrid grading for essays
                        const effectiveGradingMode = isTkaMode ? 'hybrid' : ((essayConfig.gradingMode as any) ?? 'manual');
                        const graded = autoGradeEssay({
                            answer: q.answerText,
                            correctAnswer: essayConfig.correctAnswer ?? undefined,
                            keywords,
                            gradingMode: effectiveGradingMode,
                            maxScore: essayConfig.maxScore ?? 100,
                        });
                        
                        if (isTkaMode) {
                            const eMax = essayConfig.maxScore ?? 100;
                            score = eMax > 0 ? (graded.score / eMax) * qScoreRight : 0;
                        } else {
                            score = graded.score;
                        }
                        essayNotes = graded.notes;
                    } else {
                        score = 0;
                        essayNotes = 'Menunggu koreksi guru.';
                    }
                } else if (qData?.type === 4 && q.answerText && q.answerText.trim() !== '') {
                    isAnswered = true;
                    const matchingAnswers = await db.select().from(questionAnswers).where(eq(questionAnswers.questionId, q.questionId)).all();
                    
                    let totalWeight = 0;
                    let correctPairs = 0;
                    try {
                        const parsedPairs = JSON.parse(q.answerText);
                        for (const lId in parsedPairs) {
                            const val = parsedPairs[lId];
                            if (!val) continue;
                            
                            const leftAns = matchingAnswers.find(x => x.id === parseInt(lId));
                            if (leftAns && leftAns.matchRight && leftAns.matchRight.trim() === val.trim()) {
                                totalWeight += (leftAns.weight ?? 1);
                                correctPairs++;
                            }
                        }
                    } catch(e) {
                         console.error("Failed parsing type 4 match:", e);
                    }
                    
                    if (isTkaMode) {
                        // TKA Mode: setiap pasangan benar = qScoreRight poin
                        score = correctPairs * qScoreRight;
                    } else {
                        score = totalWeight;
                    }
                } else {
                    score = scoreUnanswered;
                }

                batchOps.push(
                    db.update(testQuestions)
                        .set({ score, isAnswered, ...(essayNotes ? { essayNotes } : {}) })
                        .where(eq(testQuestions.id, q.id))
                );
            }

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

        if (testData?.mode === 'tka') {
            return redirect(`/siswa/tka?msg=success`);
        }
        return redirect(`/siswa/ujian?msg=success`);

    } catch (error: any) {
        console.error("Test Submission Error:", error);
        return redirect(`/siswa/ujian?msg=error`);
    }
};
