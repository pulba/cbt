import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

let _db: any = null;

function getDb() {
    if (_db) return _db;
    
    const url = import.meta.env.TURSO_DATABASE_URL || (globalThis as any).process?.env?.TURSO_DATABASE_URL;
    const authToken = import.meta.env.TURSO_AUTH_TOKEN || (globalThis as any).process?.env?.TURSO_AUTH_TOKEN;
    
    if (!url) {
        throw new Error("TURSO_DATABASE_URL is not defined");
    }

    const client = createClient({ url, authToken });
    _db = drizzle(client, { schema });
    return _db;
}

// Export a proxy as 'db' so it behaves like the original object but initializes lazily
export const db = new Proxy({} as any, {
    get(target, prop, receiver) {
        const instance = getDb();
        return Reflect.get(instance, prop, receiver);
    },
    apply(target, thisArg, argumentsList) {
        const instance = getDb();
        return Reflect.apply(instance, thisArg, argumentsList);
    }
});
