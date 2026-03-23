import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';
import { eq, and } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const testTable = sqliteTable('test_bool', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    val: integer('val', { mode: 'boolean' }).default(false),
});

async function main() {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client);

    try {
        console.log("Testing Boolean eq filter...");
        // This is just a conceptual test since the table doesn't exist, but I can check the generated SQL
        // Alternatively, I'll just check the existing testQuestionAnswers table via drizzle
        
        // I'll import the real schema if possible, or just define it here
        const testQuestionAnswers = sqliteTable('test_question_answers', {
            id: integer('id').primaryKey({ autoIncrement: true }),
            isSelected: integer('is_selected', { mode: 'boolean' }),
        });

        const query = db.select().from(testQuestionAnswers).where(eq(testQuestionAnswers.isSelected, true));
        console.log("Query for true:", query.toSQL());

        const queryFalse = db.select().from(testQuestionAnswers).where(eq(testQuestionAnswers.isSelected, false));
        console.log("Query for false:", queryFalse.toSQL());

    } catch (e) {
        console.error(e);
    } finally {
        client.close();
    }
}

main();
