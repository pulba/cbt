import { createClient } from '@libsql/client';

const client = createClient({
    url: 'libsql://cbt-pulba.aws-ap-northeast-1.turso.io',
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI2MTUzMTcsImlkIjoiMDE5Y2I4MWItMjQwMS03MWQxLWI5ZjgtNTRhYTc4ZjcxYzg5IiwicmlkIjoiYzM5ZmY4OWYtYWZiMy00MTQ1LWI1OTktZDUwZThlOGQyNjNiIn0.L6lPaRqNW2kvcMhHlmEBzV5k1uceOaGsJiBiSQwIhVgSQtk0XBNYHk3USrjdjIVgIPi02K8llDF9SbfPsf48Bw',
});

async function main() {
    try {
        console.log("Adding column tka_score_config to tests...");
        await client.execute({
            sql: `ALTER TABLE tests ADD COLUMN tka_score_config TEXT`,
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
