// A script to mock the Astro APIRoute logic to test if it runs successfully
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, and } from 'drizzle-orm';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client);

async function testSimpan() {
    try {
        const { testQuestions, testQuestionAnswers, testUsers } = await import('./src/db/schema.ts');

        // Pick a question from the most recent session
        const testQ = await client.execute({
            sql: `SELECT id, question_id, test_user_id FROM test_questions ORDER BY id DESC LIMIT 1`,
            args: []
        });
        if(testQ.rows.length === 0) return console.log("No questions");
        const tqId = Number(testQ.rows[0].id);
        const uId = Number(testQ.rows[0].test_user_id);
        
        const ansRows = await client.execute({
            sql: `SELECT id, test_question_id, answer_id FROM test_question_answers WHERE test_question_id = ? LIMIT 1`,
            args: [tqId]
        });
        if(ansRows.rows.length === 0) return console.log("No answers to pick");
        const ansId = Number(ansRows.rows[0].answer_id);
        
        console.log(`Trying to save answering tqId=${tqId}, ansId=${ansId}`);
        
        // Ownership check mock
        const qRows = await db
            .select({ userId: testUsers.userId })
            .from(testQuestions)
            .innerJoin(testUsers, eq(testQuestions.testUserId, testUsers.id))
            .where(eq(testQuestions.id, tqId))
            .limit(1);
        console.log("QRows found:", qRows);

        // Actual updates
        console.log("Updating isSelected: false");
        await db
            .update(testQuestionAnswers)
            .set({ isSelected: false })
            .where(eq(testQuestionAnswers.testQuestionId, tqId));

        console.log("Updating isSelected: true");
        await db
            .update(testQuestionAnswers)
            .set({ isSelected: true })
            .where(
                and(
                    eq(testQuestionAnswers.testQuestionId, tqId),
                    eq(testQuestionAnswers.answerId, ansId)
                )
            );
            
        console.log("Updating isAnswered: true");
        await db
            .update(testQuestions)
            .set({ isAnswered: true })
            .where(eq(testQuestions.id, tqId));
            
        console.log("Success!");
    } catch (e) {
        console.error("ERROR CAUGHT:", e);
    }
    client.close();
}
testSimpan();
