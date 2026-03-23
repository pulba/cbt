import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    try {
        console.log("Checking test_users for Test ID 3...");
        const users = await client.execute("SELECT * FROM test_users WHERE test_id = 3");
        console.log("Users:", JSON.stringify(users.rows, null, 2));

        if (users.rows.length > 0) {
            const sessId = users.rows[0].id;
            console.log(`Checking questions for session ${sessId}...`);
            const qs = await client.execute({
                sql: "SELECT id, score FROM test_questions WHERE test_user_id = ? AND score > 0",
                args: [sessId]
            });
            console.log(`Found ${qs.rows.length} questions with score > 0.`);
            if (qs.rows.length > 0) {
                console.log("Samples:", JSON.stringify(qs.rows.slice(0, 5), null, 2));
            }

            console.log("Checking ALL answers for this session (first 10)...");
            const ans = await client.execute({
                sql: `SELECT tqa.*
                      FROM test_question_answers tqa
                      JOIN test_questions tq ON tqa.test_question_id = tq.id
                      WHERE tq.test_user_id = ? LIMIT 10`,
                args: [sessId]
            });
            console.log("All Answers (sample):", JSON.stringify(ans.rows, null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        client.close();
    }
}

main();
