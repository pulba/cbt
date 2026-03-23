import type { APIRoute } from 'astro';

import { db } from '../../../db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { verifyToken } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies, locals }) => {
    // Reset isLogin if it's a student
    const studentToken = cookies.get('cbt_student_session')?.value;
    if (studentToken) {
        try {
            const secret = (locals as any).runtime?.env?.JWT_SECRET;
            const user = await verifyToken(studentToken, secret);
            if (user && user.role === 'student') {
                await db.update(users).set({ isLogin: false }).where(eq(users.id, user.id)).run();
            }
        } catch (e) {
            console.error('[LOGOUT ERROR]', e);
        }
    }

    cookies.delete('cbt_admin_session', { path: '/' });
    cookies.delete('cbt_student_session', { path: '/' });

    return new Response(null, {
        status: 302,
        headers: { Location: '/' },
    });
};
