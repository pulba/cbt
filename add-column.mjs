import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    try {
        console.log("Adding column is_answered to test_questions...");
        await client.execute({
            sql: `ALTER TABLE test_questions ADD COLUMN is_answered INTEGER DEFAULT 0`,
            args: []
        });
        console.log("Success!");
    } catch(e) {
        if (e.message.includes("duplicate column name")) {
            console.log("Column already exists.");
        } else {
            console.error("Failed:", e.message);
        }
    }
    client.close();
}
main();
