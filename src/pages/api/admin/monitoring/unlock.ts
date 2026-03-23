import type { APIRoute } from 'astro';
import { db } from '../../../../db';
import { testUsers } from '../../../../db/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || (user.role !== 'admin' && user.role !== 'guru' && user.role !== 'operator')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        const body = await request.json();
        const { sessionId } = body;

        if (!sessionId) {
            return new Response(JSON.stringify({ error: 'Session ID is required' }), { status: 400 });
        }

        const sid = parseInt(sessionId);

        // Reset violations and set status back to "Doing" (1)
        await db.update(testUsers)
            .set({ 
                violationCount: 0,
                status: 1 
            })
            .where(eq(testUsers.id, sid));

        return new Response(JSON.stringify({ status: 1, message: 'Blokir berhasil dibuka' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[UNLOCK ERROR]', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
};
