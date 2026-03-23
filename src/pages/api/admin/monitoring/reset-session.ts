import type { APIRoute } from 'astro';
import { db } from '../../../../db';
import { testUsers, testQuestions, testQuestionAnswers } from '../../../../db/schema';
import { eq, inArray } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || (user.role !== 'admin' && user.role !== 'guru' && user.role !== 'operator')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        const body = await request.json();
        const { sessionId } = body;

        if (!sessionId) {
            return new Response(JSON.stringify({ error: 'Session ID is required' }), { status: 400 });
        }

        const sid = parseInt(sessionId);

        await db.transaction(async (tx) => {
            // Get all testQuestions for this session
            const tqs = await tx.select({ id: testQuestions.id }).from(testQuestions).where(eq(testQuestions.testUserId, sid)).all();
            const tqIds = tqs.map(q => q.id);

            if (tqIds.length > 0) {
                // Delete answers
                await tx.delete(testQuestionAnswers).where(inArray(testQuestionAnswers.testQuestionId, tqIds));
                // Delete questions mapping
                await tx.delete(testQuestions).where(eq(testQuestions.testUserId, sid));
            }

            // Finally delete the session
            await tx.delete(testUsers).where(eq(testUsers.id, sid));
        });

        return new Response(JSON.stringify({ status: 1, message: 'Sesi berhasil direset' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[RESET SESSION ERROR]', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
};
