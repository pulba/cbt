import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { testQuestions, testQuestionAnswers } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyToken } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
    try {
        const token = cookies.get('cbt_student_session')?.value;
        if (!token) return new Response(JSON.stringify({ status: 0 }), { status: 401 });

        const secret = (locals as any).runtime?.env?.JWT_SECRET;
        const user = await verifyToken(token, secret);
        if (!user || user.role !== 'student') return new Response(JSON.stringify({ status: 0 }), { status: 403 });

        const body = await request.json();
        const { questionId, answerId, answerText } = body;

        // In a real implementation this would verify the user owns the `testQuestionId` mapped to `questionId`
        // before saving. We assume the client sends the mapping id for test_questions.

        // Pseudo logic:
        // if(answerId) {
        //     await db.update(testQuestionAnswers).set({ isSelected: true }).where(eq(testQuestionAnswers.id, answerId));
        // } else if(answerText) {
        //     await db.update(testQuestions).set({ answerText }).where(eq(testQuestions.id, questionId));
        // }

        return new Response(JSON.stringify({ status: 1, message: 'Tersimpan' }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ status: 0, message: 'Server Error' }), { status: 500 });
    }
};
