import type { APIRoute } from "astro";
import { db } from "../../../db";
import { tests, testUsers, testQuestions, testTopicSets, questions, questionAnswers, testQuestionAnswers, testGroups } from "../../../db/schema";
import { eq, and, sql, desc, min, max, inArray } from "drizzle-orm";

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || user.role !== 'student') {
            return new Response(JSON.stringify({ status: 0, message: "Unauthorized" }), { status: 401 });
        }

        const body = await request.json();
        const { testId, token } = body;

        if (!testId) {
            return new Response(JSON.stringify({ status: 0, message: "Parameter Ujian tidak valid" }), { status: 400 });
        }

        const parsedTestId = parseInt(testId);

        // 1. Check if Test Exists & Belongs to student's group
        const testData = await db.select().from(tests).where(eq(tests.id, parsedTestId)).get();
        if (!testData) {
            return new Response(JSON.stringify({ status: 0, message: "Ujian tidak ditemukan" }), { status: 404 });
        }

        if (!testData.isActive) {
            return new Response(JSON.stringify({ status: 0, message: "Ujian ini sedang di-NONAKTIFKAN oleh Admin." }), { status: 403 });
        }

        const groupCheck = await db.select().from(testGroups)
            .where(
                and(
                    eq(testGroups.testId, parsedTestId),
                    eq(testGroups.groupId, user.groupId!)
                )
            ).get();

        if (!groupCheck) {
            return new Response(JSON.stringify({ status: 0, message: "Anda tidak berhak mengikuti ujian ini." }), { status: 403 });
        }

        // 2. Validate Time bounds (beginTime & endTime live in testTopicSets, not tests)
        const timingBounds = await db
            .select({
                beginTime: min(testTopicSets.beginTime),
                endTime: max(testTopicSets.endTime),
            })
            .from(testTopicSets)
            .where(eq(testTopicSets.testId, parsedTestId))
            .get();

        const nowMs = new Date().getTime();
        if (timingBounds?.beginTime && nowMs < new Date(timingBounds.beginTime).getTime()) {
            return new Response(JSON.stringify({ status: 0, message: "Ujian belum dimulai." }), { status: 403 });
        }
        if (timingBounds?.endTime && nowMs > new Date(timingBounds.endTime).getTime()) {
            return new Response(JSON.stringify({ status: 0, message: "Waktu ujian sudah berakhir (ditutup)." }), { status: 403 });
        }


        // 4. Check if student already has an active session
        const existingSession = await db.select().from(testUsers)
            .where(
                and(
                    eq(testUsers.testId, parsedTestId),
                    eq(testUsers.userId, user.id),
                    sql`${testUsers.status} != 5` // status 1=doing, 4=finished, 10=locked. 5 is archived.
                )
            ).orderBy(desc(testUsers.id)).get();

        if (existingSession) {
            if (existingSession.status === 4) {
                return new Response(JSON.stringify({ status: 0, message: "Anda sudah menyelesaikan ujian ini." }), { status: 403 });
            }
            if (existingSession.status === 10) {
                return new Response(JSON.stringify({ status: 0, message: "⚠️ UJIAN TERKUNCI: Anda telah terdeteksi melakukan pelanggaran. Silakan hubungi pengawas." }), { status: 403 });
            }
            // If already started (status 1), just return success so frontend redirects them to resume
            return new Response(JSON.stringify({ status: 1, message: "Resume" }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 5. THE CORE ENGINE: Generate Questions based on Blueprint Configuration
        // ----------------------------------------------------------------------------
        const blueprints = await db.select().from(testTopicSets).where(eq(testTopicSets.testId, parsedTestId)).all();

        if (blueprints.length === 0) {
            return new Response(JSON.stringify({ status: 0, message: "Ujian ini masih KOSONG (belum dikonfigurasi komposisi soalnya oleh Admin)." }), { status: 500 });
        }

        // We will collect all question IDs first, then insert them.
        let finalQuestionIds: { id: number, type: number, shuffleOptions: boolean }[] = [];

        for (const bp of blueprints) {
            // Pick N random questions from this topic
            // Note: sql`RANDOM()` is SQLite specific logic
            let query = db.select({ id: questions.id, type: questions.type })
                .from(questions)
                .where(
                    and(
                        eq(questions.topicId, bp.topicId),
                        eq(questions.type, bp.questionType)
                    )
                );

            if (bp.shuffleQuestions) {
                query = query.orderBy(sql`RANDOM()`).limit(bp.questionCount) as any;
            } else {
                query = query.orderBy(desc(questions.id)).limit(bp.questionCount) as any;
            }

            const picked = await query.all();

            if (picked.length < bp.questionCount) {
                // Even if it falls short due to admin error deleting a question later, we'll gracefully grab whatever is left
                console.warn(`Blueprint asks for ${bp.questionCount} but bank only has ${picked.length}`);
            }

            for (const p of picked) {
                finalQuestionIds.push({
                    id: p.id,
                    type: p.type,
                    shuffleOptions: bp.shuffleAnswers || false
                });
            }
        }

        // We can do an outer shuffle of the final package so topics are mixed (optional, based on future logic, right now we'll shuffle all)
        finalQuestionIds = finalQuestionIds.sort(() => Math.random() - 0.5);

        // 6. DB COMMIT: Create the User Session
        // Since Drizzle with SQLite doesn't natively do robust transactions across multiple inserts easily if we fetch insertIds, 
        // we do it sequentially. In high traffic, a formal transaction is better.

        const [newSession] = await db.insert(testUsers).values({
            testId: parsedTestId,
            userId: user.id,
            status: 1, // 1 = doing
            usedToken: null,
        }).returning();

        if (!newSession) throw new Error("Failed to create session");

        // 7. Insert the customized question layout for this user in BULK
        const questionsToInsert = finalQuestionIds.map((q, idx) => ({
            testUserId: newSession.id,
            questionId: q.id,
            orderIdx: idx + 1,
        }));

        const insertedQuestions = await db.insert(testQuestions).values(questionsToInsert).returning();

        // 8. Fetch and Insert Answers in BULK (for Multiple Choice)
        const pgQuestionIds = finalQuestionIds.filter(q => q.type === 1).map(q => q.id);
        
        if (pgQuestionIds.length > 0) {
            const allAnswers = await db.select({
                id: questionAnswers.id,
                questionId: questionAnswers.questionId
            })
            .from(questionAnswers)
            .where(inArray(questionAnswers.questionId, pgQuestionIds))
            .all();

            const answersToInsert: any[] = [];
            
            for (const tq of insertedQuestions) {
                const qBlueprint = finalQuestionIds.find(f => f.id === tq.questionId);
                if (qBlueprint?.type === 1) {
                    let qAnswers = allAnswers.filter(a => a.questionId === tq.questionId);
                    
                    if (qBlueprint.shuffleOptions) {
                        qAnswers = qAnswers.sort(() => Math.random() - 0.5);
                    }

                    let ansOrderIdx = 1;
                    qAnswers.forEach(a => {
                        answersToInsert.push({
                            testQuestionId: tq.id,
                            answerId: a.id,
                            orderIdx: ansOrderIdx++
                        });
                    });
                }
            }

            if (answersToInsert.length > 0) {
                await db.insert(testQuestionAnswers).values(answersToInsert);
            }
        }

        // Done! Front end can now redirect safely
        return new Response(JSON.stringify({ status: 1, message: "Berhasil memulai ujian" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        try {
            const fs = await import('fs');
            fs.appendFileSync('C:/tmp/simpan_log.txt', new Date().toISOString() + ' - Generate Soal Error: ' + error.message + '\n' + error.stack + '\n');
        } catch(e) {}
        console.error("Test Init Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Server error saat membuat sesi ujian" }), { status: 500 });
    }
};
