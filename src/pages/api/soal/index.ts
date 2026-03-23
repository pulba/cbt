import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { questions, questionAnswers } from '../../../db/schema';
import { eq, like, sql } from 'drizzle-orm';

// GET questions (with pagination + search)
export const GET: APIRoute = async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const search = url.searchParams.get('search') || '';
    const topicId = url.searchParams.get('topic_id');
    const offset = (page - 1) * limit;

    let query = db.select().from(questions);

    const conditions = [];
    if (search) conditions.push(like(questions.text, `%${search}%`));
    if (topicId) conditions.push(eq(questions.topicId, parseInt(topicId)));

    const allQuestions = conditions.length > 0
        ? await query.where(sql`${conditions.map(c => c).join(' AND ')}`).limit(limit).offset(offset)
        : await query.limit(limit).offset(offset);

    const [countResult] = await db.select({ value: sql`count(*)`.mapWith(Number) }).from(questions);

    return new Response(JSON.stringify({
        data: allQuestions,
        total: countResult.value,
        page,
        limit,
    }), { headers: { 'Content-Type': 'application/json' } });
};

// POST create question with answers
export const POST: APIRoute = async ({ request }) => {
    const body = await request.json();
    const { topicId, type, text, difficulty, answers, shortAnswerKey } = body;

    if (!text || !topicId || !type) {
        return new Response(JSON.stringify({ error: 'Data soal tidak lengkap' }), { status: 400 });
    }

    // Insert question
    const [question] = await db.insert(questions).values({
        topicId,
        type,
        text,
        difficulty: difficulty || 1,
    }).returning();

    // Insert answer options (for PG type=1)
    if (type === 1 && answers && answers.length > 0) {
        const answerValues = answers.map((a: { text: string; isCorrect: boolean }) => ({
            questionId: question.id,
            text: a.text,
            isCorrect: a.isCorrect || false,
        }));
        await db.insert(questionAnswers).values(answerValues);
    }

    // For short answer type=3, store the key in question text
    // (already handled by text field or we can add a key column later)

    return new Response(JSON.stringify({ status: 1, data: question }), {
        headers: { 'Content-Type': 'application/json' },
    });
};

// DELETE question and its answers
export const DELETE: APIRoute = async ({ request }) => {
    const { id } = await request.json();

    // Delete answers first
    await db.delete(questionAnswers).where(eq(questionAnswers.questionId, id));
    // Delete question
    await db.delete(questions).where(eq(questions.id, id));

    return new Response(JSON.stringify({ status: 1 }), {
        headers: { 'Content-Type': 'application/json' },
    });
};
