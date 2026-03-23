import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    console.log("Resetting login status for all students...");
    await client.execute('UPDATE users SET is_login = 0');
    console.log("Success! All students are logged out from conflicting devices.");
    client.close();
}
main();
