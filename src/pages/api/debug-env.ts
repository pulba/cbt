import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
    try {
        const runtime = (locals as any).runtime;
        const env = runtime?.env || {};
        
        const envKeys = Object.keys(env);
        const processKeys = (globalThis as any).process?.env ? Object.keys((globalThis as any).process.env) : [];
        
        const bcrypt = await import('bcryptjs');
        const start = Date.now();
        const testHash = await bcrypt.hash('admin123', 8); // Lower rounds for testing
        const testMatch = await bcrypt.compare('admin123', testHash);
        const duration = Date.now() - start;

        return new Response(JSON.stringify({
            status: 'ok',
            runtime_exists: !!runtime,
            env_keys: envKeys,
            vars_check: {
                TURSO_URL: !!(env.TURSO_DATABASE_URL || (globalThis as any).process?.env?.TURSO_DATABASE_URL),
                TURSO_TOKEN: !!(env.TURSO_AUTH_TOKEN || (globalThis as any).process?.env?.TURSO_AUTH_TOKEN),
                JWT_SECRET: !!(env.JWT_SECRET || (globalThis as any).process?.env?.JWT_SECRET),
            },
            bcrypt_test: {
                match: testMatch,
                duration_ms: duration
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
