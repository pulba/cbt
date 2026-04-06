import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { configs } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async () => {
    try {
        const logoConfig = await db.select().from(configs).where(eq(configs.key, 'school_logo')).get();
        if (!logoConfig || !logoConfig.value) {
            return new Response(null, { status: 404 });
        }
        
        const value = logoConfig.value;
        const matches = value.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
            // Jika bukan base64, mungkin URL
            if (value.startsWith('http')) {
                return Response.redirect(value, 302);
            }
            return new Response(null, { status: 400 });
        }
        
        const mimeType = matches[1];
        const base64Data = matches[2];
        
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        return new Response(bytes.buffer, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600'
            }
        });
    } catch (e) {
        return new Response(null, { status: 500 });
    }
};
