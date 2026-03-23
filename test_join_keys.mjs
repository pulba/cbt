import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { eq, and } from 'drizzle-orm';
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
        console.log("Checking Join Result Keys...");
        const result = await db.select()
            .from(testQuestionAnswers)
            .innerJoin(questionAnswers, eq(testQuestionAnswers.answerId, questionAnswers.id))
            .limit(1)
            .all();
        
        if (result.length > 0) {
            console.log("Keys in result[0]:", Object.keys(result[0]));
        } else {
            console.log("No rows found for join test.");
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.close();
    }
}

main();
