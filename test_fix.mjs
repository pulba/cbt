import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    try {
        console.log("Manually setting one answer to selected for session 2...");
        // Get the first question for session 2
        const qs = await client.execute({
            sql: "SELECT id FROM test_questions WHERE test_user_id = 2 LIMIT 1",
            args: []
        });
        
        if (qs.rows.length > 0) {
            const tqId = qs.rows[0].id;
            console.log(`Setting answer for test_question_id ${tqId}...`);
            
            // Get an answer ID for this question
            const ans = await client.execute({
                sql: "SELECT id FROM test_question_answers WHERE test_question_id = ? LIMIT 1",
                args: [tqId]
            });
            
            if (ans.rows.length > 0) {
                const aId = ans.rows[0].id;
                const result = await client.execute({
                    sql: "UPDATE test_question_answers SET is_selected = 1 WHERE id = ?",
                    args: [aId]
                });
                console.log("Update result:", result.rowsAffected);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        client.close();
    }
}

main();
