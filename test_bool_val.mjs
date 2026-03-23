import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const questionAnswers = sqliteTable('question_answers', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    isCorrect: integer('is_correct', { mode: 'boolean' }),
});

const testQuestionAnswers = sqliteTable('test_question_answers', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    answerId: integer('answer_id').references(() => questionAnswers.id),
    isSelected: integer('is_selected', { mode: 'boolean' }),
});

async function main() {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client);

    try {
        console.log("Testing Boolean value in Join result...");
        const result = await db.select()
            .from(testQuestionAnswers)
            .innerJoin(questionAnswers, eq(testQuestionAnswers.answerId, questionAnswers.id))
            .where(eq(testQuestionAnswers.id, 1)) // The one I manually set
            .all();
        
        if (result.length > 0) {
            const val = result[0].question_answers.isCorrect;
            console.log(`isCorrect value type: ${typeof val}, value: ${val}`);
            console.log(`val === true? ${val === true}`);
            console.log(`val === 1? ${val === 1}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.close();
    }
}

main();
