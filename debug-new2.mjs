import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    console.log("=== Checking recent test users ===");
    const users = await client.execute(`
        SELECT tu.id as sessionId, tu.test_id, tu.user_id, tu.status, u.first_name 
        FROM test_users tu JOIN users u ON tu.user_id = u.id 
        ORDER BY tu.id DESC LIMIT 3
    `);
    console.log("Recent sessions:", users.rows);

    for (const sess of users.rows) {
        const sessionId = Number(sess.sessionId);
        console.log(`\n=== Details for session ${sessionId} (${sess.first_name}) ===`);
        
        const testQ = await client.execute({
            sql: `SELECT id, question_id, score, is_answered FROM test_questions WHERE test_user_id = ?`,
            args: [sessionId]
        });
        
        const qIds = testQ.rows.map(q => Number(q.id));
        let selectedCount = 0;
        let totalCount = 0;
        if (qIds.length > 0) {
            const placeholders = qIds.map(() => '?').join(',');
            const ans = await client.execute({
                sql: `SELECT is_selected FROM test_question_answers WHERE test_question_id IN (${placeholders})`,
                args: qIds
            });
            totalCount = ans.rows.length;
            selectedCount = ans.rows.filter(a => Number(a.is_selected) === 1).length;
        }
        console.log(`Questions: ${testQ.rows.length}`);
        console.log(`Of these, answers with is_answered=1: ${testQ.rows.filter(q => Number(q.is_answered) === 1).length}`);
        console.log(`Options with is_selected=1: ${selectedCount} out of ${totalCount}`);
    }
    client.close();
}
main();
