import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

function getDBConfig() {
    return {
        url: import.meta.env.TURSO_DATABASE_URL || (globalThis as any).process?.env?.TURSO_DATABASE_URL,
        authToken: import.meta.env.TURSO_AUTH_TOKEN || (globalThis as any).process?.env?.TURSO_AUTH_TOKEN,
    };
}

const config = getDBConfig();
const client = createClient(config);

export const db = drizzle(client, { schema });
