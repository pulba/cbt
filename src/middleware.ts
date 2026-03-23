import { defineMiddleware } from 'astro:middleware';
import { verifyToken } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
const { url, cookies, locals, redirect } = context;
const path = url.pathname;

// Allow auth API
if (path.startsWith('/api/auth/')) return next();

    const runtime = (context.locals as any).runtime;
    const secret = runtime?.env?.JWT_SECRET;

    // Admin area -> protected
    if (path.startsWith('/admin')) {
        const token = cookies.get('cbt_admin_session')?.value;
        if (!token) return redirect('/');
        const user = await verifyToken(token, secret);
    if (!user || user.role === 'student') return redirect('/');
    locals.user = user;

    const role = user.role;
    
    // Path-based restrictions (RBAC)
    if (role === 'operator') {
        // Operator only allowed: /admin, /admin/monitoring, /admin/hasil, /admin/profil
        const allowed = ['/admin', '/admin/monitoring', '/admin/hasil', '/admin/profil'];
        const isAllowed = allowed.some(p => path === p || path.startsWith(p + '/'));
        if (!isAllowed) return redirect('/admin?error=unauthorized');
    }

    if (role === 'guru') {
        // Guru restricted from: /admin/pengaturan
        if (path.startsWith('/admin/pengaturan')) {
            return redirect('/admin?error=unauthorized');
        }
    }

    return next();
}

// Student LOGIN pages -> public
if (path === '/siswa' || path === '/siswa/') return next();

// Student exam pages -> protected
    if (path.startsWith('/siswa/ujian') || path.startsWith('/siswa/kerjakan') || path.startsWith('/siswa/konfirmasi')) {
    const token = cookies.get('cbt_student_session')?.value;
    if (!token) return redirect('/siswa');
    const user = await verifyToken(token, secret);
    if (!user || user.role !== 'student') return redirect('/siswa');
locals.user = user;
return next();
}

// Student API routes -> verify session but don't redirect (return 401 is fine)
if (path.startsWith('/api/peserta/')) {
    const token = cookies.get('cbt_student_session')?.value;
    if (token) {
        const user = await verifyToken(token, secret);
        if (user && user.role === 'student') {
            locals.user = user;
        }
    }
    return next();
}

// Admin/Universal API routes (starts with /api/ but not /api/peserta/)
    if (path.startsWith('/api/')) {
        // Try admin session first
        const adminToken = cookies.get('cbt_admin_session')?.value;
        if (adminToken) {
            const user = await verifyToken(adminToken, secret);
            if (user && user.role !== 'student') {
                locals.user = user;
                return next();
            }
        }
        // Fallback/Check for student session if it might be a shared API
        const studentToken = cookies.get('cbt_student_session')?.value;
        if (studentToken) {
            const user = await verifyToken(studentToken, secret);
            if (user) {
            locals.user = user;
        }
    }
    return next();
}

return next();
});

