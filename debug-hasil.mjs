// Test simpan-jawaban logic directly
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, and } from 'drizzle-orm';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client);

// Get a test question answer for session 18
const check = await client.execute({
    sql: `SELECT tqa.id, tqa.test_question_id, tqa.answer_id, tqa.is_selected, qa.is_correct
          FROM test_question_answers tqa 
          JOIN question_answers qa ON tqa.answer_id = qa.id
          WHERE tqa.test_question_id = 152
          LIMIT 5`,
    args: []
});
console.log("testQuestionAnswers for q 152:", check.rows);

// Simulate what simpan-jawaban does
const testQuestionId = 152;
const answerId = Number(check.rows[0].answer_id);

console.log(`\nSimulating: save answer ${answerId} for testQuestionId ${testQuestionId}`);

const { testQuestionAnswers } = await import('./src/db/schema.ts');

// Step 1: Reset
await db.update(testQuestionAnswers)
    .set({ isSelected: false })
    .where(eq(testQuestionAnswers.testQuestionId, testQuestionId));

// Step 2: Select
const result = await db.update(testQuestionAnswers)
    .set({ isSelected: true })
    .where(and(
        eq(testQuestionAnswers.testQuestionId, testQuestionId),
        eq(testQuestionAnswers.answerId, answerId)
    ));

const verify = await client.execute({
    sql: `SELECT id, answer_id, is_selected FROM test_question_answers WHERE test_question_id = 152`,
    args: []
});
console.log("After update:", verify.rows);

// Reset back
await client.execute({
    sql: `UPDATE test_question_answers SET is_selected = 0 WHERE test_question_id = 152`,
    args: []
});
console.log("Reset done");

client.close();
