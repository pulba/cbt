import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addColumn(sql) {
    try {
        await client.execute({ sql, args: [] });
        console.log('OK:', sql.substring(0, 60));
    } catch(e) {
        if (e.message.includes('duplicate column name')) {
            console.log('Already exists, skip:', sql.substring(0, 60));
        } else {
            console.error('FAILED:', e.message);
        }
    }
}

async function main() {
    console.log('--- TKA Migration ---');
    await addColumn(`ALTER TABLE tests ADD COLUMN mode TEXT DEFAULT 'standard'`);
    await addColumn(`ALTER TABLE test_topic_sets ADD COLUMN score_right_override REAL`);
    await addColumn(`ALTER TABLE test_topic_sets ADD COLUMN score_wrong_override REAL`);
    console.log('--- Done ---');
    client.close();
}

main();
