import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { topics } from '../../../db/schema';
import { eq } from 'drizzle-orm';

// GET all topics
export const GET: APIRoute = async () => {
    const allTopics = await db.select().from(topics);
    return new Response(JSON.stringify(allTopics), {
        headers: { 'Content-Type': 'application/json' },
    });
};

// POST create topic
export const POST: APIRoute = async ({ request }) => {
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
        return new Response(JSON.stringify({ error: 'Nama topik harus diisi' }), { status: 400 });
    }

    const result = await db.insert(topics).values({ name, description }).returning();
    return new Response(JSON.stringify({ status: 1, data: result[0] }), {
        headers: { 'Content-Type': 'application/json' },
    });
};

// DELETE topic
export const DELETE: APIRoute = async ({ request }) => {
    const { id } = await request.json();
    await db.delete(topics).where(eq(topics.id, id));
    return new Response(JSON.stringify({ status: 1 }), {
        headers: { 'Content-Type': 'application/json' },
    });
};
