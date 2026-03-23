import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { users, admins } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { signToken } from '../../../lib/auth';
import bcrypt from 'bcryptjs';
import { configs } from '../../../db/schema';

export const POST: APIRoute = async ({ request, cookies }) => {
try {
const body = await request.json();
const { username, password, type } = body;
const loginType = String(type || '').trim().toLowerCase();

if (!username || !password) {
return new Response(
JSON.stringify({ error: 'Username dan password wajib diisi' }),
{ status: 400, headers: { 'Content-Type': 'application/json' } }
);
}

let payload:
| { id: number; username: string; role: 'student'; groupId?: number }
| { id: number; username: string; role: 'admin' | 'guru' | 'operator' };

// LOGIN SISWA
if (loginType === 'student') {
const result = await db
.select()
.from(users)
.where(eq(users.username, username))
.limit(1);

const user = result[0];
if (!user) {
    return new Response(
        JSON.stringify({ error: 'Siswa tidak ditemukan' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
}

// Check Multi-login Protection
const multiLoginConfig = await db.select().from(configs).where(eq(configs.key, "proteksi_multilogin")).get();
if (multiLoginConfig?.value === "true" && user.isLogin) {
    // Bersihkan cookie lama jika ada konflik (agar tidak stuck di dashboard)
    cookies.delete('cbt_student_session', { path: '/' });
    return new Response(
        JSON.stringify({ error: 'Akun Anda sedang aktif di perangkat lain. Silakan hubungi admin untuk reset.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}

// dukung bcrypt + fallback plaintext lama (sementara)
let isMatch = false;
try {
    isMatch = await bcrypt.compare(password, user.password);
} catch {
    isMatch = false;
}
if (!isMatch && password !== user.password) {
    return new Response(
        JSON.stringify({ error: 'Password salah' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
}

// Set isLogin to true
await db.update(users).set({ isLogin: true }).where(eq(users.id, user.id)).run();

payload = {
    id: user.id,
    username: user.username,
    role: 'student',
    groupId: user.groupId ?? undefined,
};
}
// LOGIN ADMIN / GURU / OPERATOR
else if (loginType === 'admin') {
const result = await db
.select()
.from(admins)
.where(eq(admins.username, username))
.limit(1);

const admin = result[0];
if (!admin) {
return new Response(
JSON.stringify({ error: 'Admin tidak ditemukan' }),
{ status: 404, headers: { 'Content-Type': 'application/json' } }
);
}

let isMatch = false;
try {
isMatch = await bcrypt.compare(password, admin.password);
} catch {
isMatch = false;
}
if (!isMatch && password !== admin.password) {
return new Response(
JSON.stringify({ error: 'Password salah' }),
{ status: 401, headers: { 'Content-Type': 'application/json' } }
);
}

const role = (admin.level || 'admin') as 'admin' | 'guru' | 'operator';

payload = {
id: admin.id,
username: admin.username,
role,
};
} else {
return new Response(
JSON.stringify({ error: 'Tipe login tidak valid' }),
{ status: 400, headers: { 'Content-Type': 'application/json' } }
);
}

const secret = (locals as any).runtime?.env?.JWT_SECRET;
const token = await signToken(payload as any, secret);

// Set cookie SESUAI role — dan hapus cookie role lain untuk mencegah konflik redirect
  if (payload.role === 'student') {
    // Hapus session admin jika ada
    cookies.delete('cbt_admin_session', { path: '/' });
    cookies.set('cbt_student_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      path: '/',
      maxAge: 60 * 60 * 24, // 1 hari
    });
  } else {
    // Hapus session siswa jika ada
    cookies.delete('cbt_student_session', { path: '/' });
    cookies.set('cbt_admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      path: '/',
      maxAge: 60 * 60 * 24, // 1 hari
    });
  }

return new Response(
JSON.stringify({ status: 1, message: 'Login successful', role: payload.role }),
{ status: 200, headers: { 'Content-Type': 'application/json' } }
);
} catch (error: any) {
    console.error('[LOGIN ERROR]', error);
    return new Response(
        JSON.stringify({ 
            error: 'Internal Server Error', 
            details: error.message,
            stack: error.stack 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
}
};
