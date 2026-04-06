import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { configs } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals }) => {
    const user = locals.user;
    if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    try {
        const data = await request.json();
        
        // Settings we allow to update
        const allowedKeys = [
            'school_name', 
            'school_logo',
            'cbt_nama', 
            'cbt_mobile_lock_xambro', 
            'proteksi_multilogin', 
            'cbt_informasi'
        ];

        for (const key of allowedKeys) {
            if (key in data) {
                const val = String(data[key]);
                
                // Check if exists
                const existing = await db.select().from(configs).where(eq(configs.key, key)).get();
                
                if (existing) {
                    await db.update(configs)
                        .set({ value: val })
                        .where(eq(configs.key, key))
                        .run();
                } else {
                    await db.insert(configs)
                        .values({ key: key, value: val })
                        .run();
                }
            }
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
};
