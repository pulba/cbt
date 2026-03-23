import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    console.log("=== Checking recent test users ===");
    const users = await client.execute(`SELECT id, test_id, user_id, status FROM test_users ORDER BY id DESC LIMIT 1`);

    if (users.rows.length > 0) {
        const sessionId = Number(users.rows[0].id);
        const testId = Number(users.rows[0].test_id);
        console.log(`\n=== Details for latest session ${sessionId} (Test ${testId}) ===`);
        
        const testQ = await client.execute({
            sql: `SELECT id, question_id, order_idx, score, is_answered FROM test_questions WHERE test_user_id = ?`,
            args: [sessionId]
        });
        console.log(`Questions count: ${testQ.rows.length}`);
        
        const qIds = testQ.rows.map(q => Number(q.id));
        if (qIds.length > 0) {
            const placeholders = qIds.map(() => '?').join(',');
            const ans = await client.execute({
                sql: `SELECT id, test_question_id, answer_id, is_selected FROM test_question_answers WHERE test_question_id IN (${placeholders})`,
                args: qIds
            });
            console.log(`Answers Total rows in DB for this session: ${ans.rows.length}`);
            console.log("First 5 answers:", ans.rows.slice(0, 5));
        }
    }
    client.close();
}
main();
