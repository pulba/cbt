import type { APIRoute } from "astro";
import { db } from "../../../db";
import { testGroups, testTopicSets, questions, tests, testUsers } from "../../../db/schema";
import { eq, and, lt, sql } from "drizzle-orm";

// 1. POST: Add a Topic component to the test
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { testId, topicId, questionCount, questionType = 1, shuffleQuestions, shuffleAnswers, durationMinutes, beginTime, endTime, scoreRightOverride, scoreWrongOverride } = body;

        if (!testId || !topicId || !questionCount || questionCount <= 0 || !durationMinutes) {
            return new Response(JSON.stringify({ status: 0, message: "Invalid parameters" }), { status: 400 });
        }

        // Active Lock Check: Only lock if there are students who haven't finished (status < 4)
        const activeSessions = await db.select().from(testUsers).where(and(eq(testUsers.testId, testId), lt(testUsers.status, 4))).all();
        if (activeSessions.length > 0) {
            return new Response(JSON.stringify({ status: 0, message: "Akses Ditolak: Ujian terkunci karena masih ada peserta yang aktif." }), { status: 403 });
        }

        // Before adding, check if we have enough questions in the bank for this exact topic & type
        // For questionType 7 (Campuran/TKA), count ALL questions in the topic regardless of individual type
        const [available] = await db.select({ count: sql<number>`count(*)` })
            .from(questions)
            .where(
                questionType === 7
                    ? eq(questions.topicId, topicId)
                    : and(
                        eq(questions.topicId, topicId),
                        eq(questions.type, questionType)
                    )
            );

        if (available.count < questionCount) {
            return new Response(JSON.stringify({
                status: 0,
                message: `Ditolak: Anda meminta ${questionCount} soal, tapi bank soal untuk topik ini hanya memiliki ${available.count} soal.`
            }), { status: 400 });
        }

        // Check if topic is already added to this test (prevent duplicate identical topic+type combos)
        const existing = await db.select().from(testTopicSets).where(
            and(
                eq(testTopicSets.testId, testId),
                eq(testTopicSets.topicId, topicId),
                eq(testTopicSets.questionType, questionType)
            )
        ).all();

        if (existing.length > 0) {
            return new Response(JSON.stringify({ status: 0, message: "Topik dengan tipe soal yang sama sudah ada di blueprint ujian ini." }), { status: 400 });
        }

        // Get Test Details for Auto TKA Scores
        const testData = await db.select().from(tests).where(eq(tests.id, testId)).get();
        let finalScoreRight = scoreRightOverride !== undefined && scoreRightOverride !== "" ? parseFloat(scoreRightOverride) : null;
        
        if (finalScoreRight === null && testData?.mode === 'tka' && testData?.tkaScoreConfig) {
            try {
                const config = JSON.parse(testData.tkaScoreConfig);
                if (config[questionType] !== undefined) {
                    finalScoreRight = parseFloat(config[questionType]);
                }
            } catch (e) {}
        }

        // Insert new topic set rules
        await db.insert(testTopicSets).values({
            testId,
            topicId,
            questionType,
            questionCount,
            difficulty: 0, // default mixed
            shuffleQuestions: shuffleQuestions === true,
            shuffleAnswers: shuffleAnswers === true,
            answerCount: 4, // default to 4 for PG
            durationMinutes: parseInt(durationMinutes) || 60,
            beginTime: beginTime ? new Date(beginTime) : null,
            endTime: endTime ? new Date(endTime) : null,
            scoreRightOverride: finalScoreRight,
            scoreWrongOverride: scoreWrongOverride !== undefined && scoreWrongOverride !== "" ? parseFloat(scoreWrongOverride) : null
        });

        return new Response(JSON.stringify({ status: 1, message: "Topik berhasil ditambahkan" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Add Topic Set Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Terjadi kesalahan server." }), { status: 500 });
    }
};

// 2. PUT: Sync user groups
export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { testId, groups, action } = body;

        if (action !== "sync_groups" || !testId || !Array.isArray(groups)) {
            return new Response(JSON.stringify({ status: 0, message: "Format payload tidak valid." }), { status: 400 });
        }

        // Active Lock Check: Only lock if there are students who haven't finished (status < 4)
        const activeSessions = await db.select().from(testUsers).where(and(eq(testUsers.testId, testId), lt(testUsers.status, 4))).all();
        if (activeSessions.length > 0) {
            return new Response(JSON.stringify({ status: 0, message: "Akses Ditolak: Ujian terkunci karena masih ada peserta yang aktif." }), { status: 403 });
        }

        // To sync, we first delete all current assignments for the test, then re-insert
        await db.delete(testGroups).where(eq(testGroups.testId, testId));

        if (groups.length > 0) {
            const insertPayload = groups.map(gId => ({ testId, groupId: gId }));
            await db.insert(testGroups).values(insertPayload);
        }

        return new Response(JSON.stringify({ status: 1, message: "Grup berhasil disinkronisasi" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Sync Groups Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Terjadi kesalahan server saat menyimpan grup." }), { status: 500 });
    }
};

// 3. DELETE: Remove a Topic Set from the test
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { testId, topicSetId } = body;

        if (!testId || !topicSetId) {
            return new Response(JSON.stringify({ status: 0, message: "ID Ujian & ID Topik tidak ditemukan." }), { status: 400 });
        }

        // Active Lock Check: Only lock if there are students who haven't finished (status < 4)
        const activeSessions = await db.select().from(testUsers).where(and(eq(testUsers.testId, testId), lt(testUsers.status, 4))).all();
        if (activeSessions.length > 0) {
            return new Response(JSON.stringify({ status: 0, message: "Akses Ditolak: Ujian terkunci karena masih ada peserta yang aktif." }), { status: 403 });
        }

        await db.delete(testTopicSets).where(
            and(
                eq(testTopicSets.id, topicSetId),
                eq(testTopicSets.testId, testId)
            )
        );

        return new Response(JSON.stringify({ status: 1, message: "Komposisi soal berhasil dihapus" }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Delete Topic Set Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Terjadi kesalahan server saat menghapus komponen topik." }), { status: 500 });
    }
};

// 4. PATCH: Update schedule (beginTime, endTime, durationMinutes) for a topic set
// Note: No active-user lock here — admin can reschedule anytime.
export const PATCH: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { topicSetId, testId, beginTime, endTime, durationMinutes, retake } = body;

        if (!topicSetId || !testId || !durationMinutes || durationMinutes <= 0) {
            return new Response(JSON.stringify({ status: 0, message: "Parameter tidak valid." }), { status: 400 });
        }

        await db
            .update(testTopicSets)
            .set({
                durationMinutes: parseInt(durationMinutes),
                beginTime: beginTime ? new Date(beginTime) : null,
                endTime: endTime ? new Date(endTime) : null,
            })
            .where(
                and(
                    eq(testTopicSets.id, topicSetId),
                    eq(testTopicSets.testId, testId)
                )
            );

        // Handle Archive/Retake logic
        if (retake) {
            await db.update(testUsers)
                .set({ status: 5 }) // 5: Archived
                .where(
                    and(
                        eq(testUsers.testId, testId),
                        eq(testUsers.status, 4) // Only finished sessions
                    )
                );
        }

        return new Response(JSON.stringify({ status: 1, message: "Jadwal berhasil diperbarui." }), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error("Update Schedule Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Terjadi kesalahan server saat memperbarui jadwal." }), { status: 500 });
    }
};
