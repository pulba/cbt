import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    console.log("=== Checking session 24 (Muhammad Iqbal) ===");
    
    const testQ = await client.execute({
        sql: `SELECT id, question_id, score, is_answered FROM test_questions WHERE test_user_id = 24`,
        args: []
    });
    
    const qIds = testQ.rows.map(q => Number(q.id));
    if (qIds.length > 0) {
        const placeholders = qIds.map(() => '?').join(',');
        const ans = await client.execute({
            sql: `SELECT id, test_question_id, answer_id, is_selected FROM test_question_answers WHERE test_question_id IN (${placeholders})`,
            args: qIds
        });
        
        const selected = ans.rows.filter(a => Number(a.is_selected) === 1);
        console.log(`\nOptions with is_selected=1: ${selected.length} out of ${ans.rows.length}`);
        console.log(selected);
        
        console.log(`\nQuestions with is_answered=1: ${testQ.rows.filter(q => Number(q.is_answered) === 1).length}`);
        console.log(`Total Score in testQuestions:`, testQ.rows.reduce((sum, q) => sum + Number(q.score || 0), 0));
    }
    client.close();
}
main();
