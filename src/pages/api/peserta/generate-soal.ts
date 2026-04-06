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
                    bp.questionType === 7
                        ? eq(questions.topicId, bp.topicId)
                        : and(
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
        if (testData?.mode === 'tka') {
            // TKA Specific Sorting Logic
            let allPg = finalQuestionIds.filter(q => q.type === 1);
            let others = finalQuestionIds.filter(q => q.type !== 1);
            
            // Randomize PG first so we can pick 3
            allPg = allPg.sort(() => Math.random() - 0.5);
            
            const firstThreePg = allPg.splice(0, 3);
            const remainingPgBlocks = allPg.map(q => [q]); // wrap each remaining PG in an array to act as a block of size 1
            
            // Group others by type into blocks
            const typeIds = [...new Set(others.map(q => q.type))];
            let otherBlocks: (typeof finalQuestionIds)[] = [];
            
            for (const t of typeIds) {
                let group = others.filter(q => q.type === t);
                group = group.sort(() => Math.random() - 0.5); // shuffle within the block
                otherBlocks.push(group);
            }
            
            // Shuffle the non-PG blocks among themselves natively
            otherBlocks = otherBlocks.sort(() => Math.random() - 0.5);
            
            // Sprinkle remaining PGs
            if (otherBlocks.length > 0) {
                // Ensure the first element of mixed blocks is ALWAYS a non-PG block (so question 4 is never PG)
                for (const pgBlock of remainingPgBlocks) {
                    // Random insertion slot from 1 to current max length (inclusive)
                    // This protects index 0, so the first block remains non-PG
                    const slotIndex = Math.floor(Math.random() * otherBlocks.length) + 1;
                    otherBlocks.splice(slotIndex, 0, pgBlock);
                }
            } else {
                // If there are no non-PG blocks at all in the exam, just append the remaining PGs
                otherBlocks = remainingPgBlocks;
            }
            
            // Flatten the mixed blocks
            let groupedOthers: typeof finalQuestionIds = [];
            for (const block of otherBlocks) {
                groupedOthers.push(...block);
            }
            
            finalQuestionIds = [...firstThreePg, ...groupedOthers];
        } else {
            // Standard Global Shuffle
            finalQuestionIds = finalQuestionIds.sort(() => Math.random() - 0.5);
        }

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

        // 8. Fetch and Insert Answers in BULK (for Multiple Choice, Matching, Ceklis, and Benar/Salah)
        const relevantQuestionIds = finalQuestionIds.filter(q => q.type === 1 || q.type === 4 || q.type === 5 || q.type === 6).map(q => q.id);
        
        if (relevantQuestionIds.length > 0) {
            const allAnswers = await db.select({
                id: questionAnswers.id,
                questionId: questionAnswers.questionId
            })
            .from(questionAnswers)
            .where(inArray(questionAnswers.questionId, relevantQuestionIds))
            .all();

            const answersToInsert: any[] = [];
            
            for (const tq of insertedQuestions) {
                const qBlueprint = finalQuestionIds.find(f => f.id === tq.questionId);
                if (qBlueprint?.type === 1 || qBlueprint?.type === 4 || qBlueprint?.type === 5 || qBlueprint?.type === 6) {
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
        console.error("Test Init Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Server error saat membuat sesi ujian" }), { status: 500 });
    }
};
