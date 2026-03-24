import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
    try {
        const runtime = (locals as any).runtime;
        const env = runtime?.env || {};
        
        const envKeys = Object.keys(env);
        const processKeys = (globalThis as any).process?.env ? Object.keys((globalThis as any).process.env) : [];
        
        const { db } = await import('../../db');
        const { admins } = await import('../../db/schema');
        const adminCount = await db.select().from(admins).all();

        const bcrypt = await import('bcryptjs');
        const testHash = await bcrypt.hash('admin123', 8);
        const testMatch = await bcrypt.compare('admin123', testHash);

        return new Response(JSON.stringify({
            status: 'ok',
            runtime_exists: !!runtime,
            env_keys: envKeys,
            vars_check: {
                TURSO_URL: !!(env.TURSO_DATABASE_URL || (globalThis as any).process?.env?.TURSO_DATABASE_URL),
                TURSO_TOKEN: !!(env.TURSO_AUTH_TOKEN || (globalThis as any).process?.env?.TURSO_AUTH_TOKEN),
                JWT_SECRET: !!(env.JWT_SECRET || (globalThis as any).process?.env?.JWT_SECRET),
            },
            db_test: {
                admin_count: adminCount.length,
                success: true
            },
            bcrypt_test: {
                match: testMatch
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e: any) {
        return new Response(JSON.stringify({
            status: 'error',
            message: e.message,
            stack: e.stack
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
