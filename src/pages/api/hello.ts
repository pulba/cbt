import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
    return new Response(JSON.stringify({ hello: 'world', time: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
