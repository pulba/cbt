import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    const users = await client.execute(`SELECT username, first_name FROM users WHERE role = 'student' ORDER BY username LIMIT 15`);
    console.log("Registered Student Usernames:");
    users.rows.forEach(u => {
        console.log(`${u.username} - ${u.first_name}`);
    });
    client.close();
}
main();
