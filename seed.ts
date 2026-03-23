import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { admins } from './src/db/schema.js'; // Note .js extension for TS node running
import bcrypt from 'bcryptjs';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const localDb = drizzle(client);

async function main() {
    console.log("Seeding default admin...");
    try {
        const hash = bcrypt.hashSync('admin123', 10);
        await localDb.insert(admins).values({
            username: 'admin',
            password: hash,
            level: 'admin',
        });
        console.log("✅ Default admin created successfully!");
        console.log("Username: admin");
        console.log("Password: admin123");
    } catch (e: any) {
        if (e.message?.includes('UNIQUE constraint failed')) {
            console.log("✅ Admin user already exists in the database.");
        } else {
            console.error("❌ Error seeding admin:", e);
        }
    }
}

main();
