import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { tests, testGroups, testTopicSets, testUsers, testQuestions, testQuestionAnswers } from '../../../db/schema';
import { eq, like, sql, and, lt } from 'drizzle-orm';

// GET list of tests
export const GET: APIRoute = async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const search = url.searchParams.get('search') || '';
    const offset = (page - 1) * limit;

    let query = db.select().from(tests);
    if (search) {
        query = query.where(like(tests.name, `%${search}%`)) as any;
    }

    const allTests = await query.limit(limit).offset(offset);
    const [countResult] = await db.select({ value: sql`count(*)`.mapWith(Number) }).from(tests);

    return new Response(JSON.stringify({
        data: allTests,
        total: countResult.value,
        page,
        limit,
    }), { headers: { 'Content-Type': 'application/json' } });
};

// POST create test
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            name, detail, mode,
            scoreRight, scoreWrong, scoreUnanswered,
            maxScore, showResult, showDetail,
            topicSets, groups, tkaScores
        } = body;

        if (!name) {
            return new Response(JSON.stringify({ status: 0, message: 'Nama Ujian wajib diisi' }), { status: 400 });
        }

        // Insert test
        const [test] = await db.insert(tests).values({
            name,
            detail,
            mode: mode ?? 'standard',
            scoreRight: scoreRight ?? 1,
            scoreWrong: scoreWrong ?? 0,
            scoreUnanswered: scoreUnanswered ?? 0,
            maxScore: maxScore ?? 0,
            showResult: showResult ?? false,
            showDetail: showDetail ?? false,
            tkaScoreConfig: tkaScores ? JSON.stringify({
                1: tkaScores.pg,
                2: tkaScores.esai,
                3: tkaScores.singkat,
                4: tkaScores.jodoh,
                5: tkaScores.ceklis,
                6: tkaScores.bs,
            }) : null,
        }).returning();

        // Assign to groups (if provided from another UI)
        if (groups && groups.length > 0) {
            const groupValues = groups.map((g: number) => ({
                testId: test.id,
                groupId: g,
            }));
            await db.insert(testGroups).values(groupValues);
        }

        // Set topic blueprint (if provided from another UI)
        if (topicSets && topicSets.length > 0) {
            const setValues = topicSets.map((ts: any) => ({
                testId: test.id,
                topicId: ts.topicId,
                questionType: ts.questionType,
                questionCount: ts.questionCount,
                difficulty: ts.difficulty || 0,
                shuffleQuestions: ts.shuffleQuestions ?? true,
                shuffleAnswers: ts.shuffleAnswers ?? true,
                answerCount: ts.answerCount || 4,
            }));
            await db.insert(testTopicSets).values(setValues);
        }

        return new Response(JSON.stringify({ status: 1, message: "Ujian berhasil dibuat", data: test }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ status: 0, message: e.message || "Failed to create test" }), { status: 500 });
    }
};

// DELETE test
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const { id } = await request.json();

        // Efficient Cascade Cleanup:
        // 1. Get all session IDs for this test
        const sessions = await db.select({ id: testUsers.id }).from(testUsers).where(eq(testUsers.testId, id)).all();
        const sessionIds = sessions.map(s => s.id);

        if (sessionIds.length > 0) {
            // 2. Clear all student answers for these sessions
            // Native SQL for batch deletion of answers linked via subquery or specific IDs
            // Identifying testQuestionIds first is safer in some SQLite environments
            const questions = await db.select({ id: testQuestions.id }).from(testQuestions).where(sql`${testQuestions.testUserId} IN ${sessionIds}`).all();
            const questionIds = questions.map(q => q.id);
            
            if (questionIds.length > 0) {
                await db.delete(testQuestionAnswers).where(sql`${testQuestionAnswers.testQuestionId} IN ${questionIds}`);
                await db.delete(testQuestions).where(sql`${testQuestions.testUserId} IN ${sessionIds}`);
            }
            
            // 3. Delete sessions
            await db.delete(testUsers).where(eq(testUsers.testId, id));
        }

        // 4. Delete associated configuration data
        await db.delete(testTopicSets).where(eq(testTopicSets.testId, id));
        await db.delete(testGroups).where(eq(testGroups.testId, id));
        
        // 5. Finally delete the test itself
        await db.delete(tests).where(eq(tests.id, id));

        return new Response(JSON.stringify({ status: 1, message: "Berhasil dihapus." }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ status: 0, message: "Gagal menghapus ujian." }), { status: 500 });
    }
};

// PUT edit test
export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            id, name, detail, mode,
            scoreRight, scoreWrong, scoreUnanswered,
            maxScore, showResult, showDetail, tkaScores
        } = body;

        if (!id) {
            return new Response(JSON.stringify({ status: 0, message: 'ID Ujian diperlukan' }), { status: 400 });
        }

        const activeSessions = await db.select().from(testUsers).where(and(eq(testUsers.testId, id), lt(testUsers.status, 4))).all();
        const isLocked = activeSessions.length > 0;

        let updateData: any = {
            showResult: showResult ?? false,
            showDetail: showDetail ?? false,
        };

        if (!isLocked) {
            updateData = {
                ...updateData,
                name,
                detail,
                mode: mode ?? 'standard',
                scoreRight: scoreRight ?? 1,
                scoreWrong: scoreWrong ?? 0,
                scoreUnanswered: scoreUnanswered ?? 0,
                maxScore: maxScore ?? 0,
            };
            if (tkaScores) {
               updateData.tkaScoreConfig = JSON.stringify({
                    1: tkaScores.pg,
                    2: tkaScores.esai,
                    3: tkaScores.singkat,
                    4: tkaScores.jodoh,
                    5: tkaScores.ceklis,
                    6: tkaScores.bs,
               });
            }
        }

        await db.update(tests).set(updateData).where(eq(tests.id, id));

        return new Response(JSON.stringify({ status: 1, message: "Perubahan berhasil disimpan" }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ status: 0, message: e.message || "Failed to edit test" }), { status: 500 });
    }
};

// PATCH: Reset sessions or toggle status
export const PATCH: APIRoute = async ({ request }) => {
    try {
        const { id, action } = await request.json();

        if (!id) {
            return new Response(JSON.stringify({ status: 0, message: 'Parameter tidak valid' }), { status: 400 });
        }

        const testId = parseInt(id);

        if (action === 'reset_sessions') {
            // Get all sessions for this test
            const sessions = await db
                .select({ id: testUsers.id })
                .from(testUsers)
                .where(eq(testUsers.testId, testId))
                .all();

            if (sessions.length === 0) {
                return new Response(JSON.stringify({ status: 0, message: 'Tidak ada sesi peserta yang perlu direset.' }), { status: 404 });
            }

            // Cascade delete: answers → questions → sessions
            for (const session of sessions) {
                const tqs = await db
                    .select({ id: testQuestions.id })
                    .from(testQuestions)
                    .where(eq(testQuestions.testUserId, session.id))
                    .all();

                for (const tq of tqs) {
                    await db.delete(testQuestionAnswers).where(eq(testQuestionAnswers.testQuestionId, tq.id));
                }
                await db.delete(testQuestions).where(eq(testQuestions.testUserId, session.id));
            }

            await db.delete(testUsers).where(eq(testUsers.testId, testId));

            return new Response(JSON.stringify({
                status: 1,
                message: `Berhasil mereset ${sessions.length} sesi peserta. Ujian dapat dikerjakan kembali.`,
                resetCount: sessions.length,
            }), { headers: { 'Content-Type': 'application/json' } });
        } 
        
        if (action === 'toggle_status') {
            const current = await db.select({ isActive: tests.isActive }).from(tests).where(eq(tests.id, testId)).get();
            if (!current) {
                return new Response(JSON.stringify({ status: 0, message: 'Ujian tidak ditemukan.' }), { status: 404 });
            }

            const newValue = !current.isActive;
            await db.update(tests).set({ isActive: newValue }).where(eq(tests.id, testId));

            return new Response(JSON.stringify({
                status: 1,
                message: `Status ujian berhasil diubah menjadi ${newValue ? 'AKTIF' : 'NONAKTIF'}.`,
                isActive: newValue
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ status: 0, message: 'Action tidak dikenal.' }), { status: 400 });

    } catch (e: any) {
        console.error('Reset sessions error:', e);
        return new Response(JSON.stringify({ status: 0, message: e.message || 'Gagal mereset sesi.' }), { status: 500 });
    }
};
