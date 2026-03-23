import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { testTokens } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request }) => {
try {
const body = await request.json();
const token = String(body?.token || '').trim();
const incomingTestId = body?.testId == null ? null : Number(body.testId);

if (!token) {
return new Response(
JSON.stringify({ valid: false, message: 'Token kosong' }),
{ status: 400, headers: { 'Content-Type': 'application/json' } }
);
}

const rows = await db
.select()
.from(testTokens)
.where(eq(testTokens.token, token))
.limit(1);

if (!rows.length) {
return new Response(
JSON.stringify({ valid: false, message: 'Token tidak ditemukan' }),
{ status: 404, headers: { 'Content-Type': 'application/json' } }
);
}

const t: any = rows[0];

// 1) Binding token ke testId (kalau token spesifik ujian)
if (t.testId != null && incomingTestId != null && Number(t.testId) !== incomingTestId) {
return new Response(
JSON.stringify({ valid: false, message: 'Token tidak cocok untuk ujian ini' }),
{ status: 403, headers: { 'Content-Type': 'application/json' } }
);
}

// 2) Expiry check
// Sesuaikan nama kolom jika beda:
const createdAtRaw = t.createdAt ?? t.creationTime ?? t.created_at;
const lifetimeMinutes = Number(t.lifetimeMinutes ?? t.lifetime_minutes ?? 0);

if (!createdAtRaw || !lifetimeMinutes) {
return new Response(
JSON.stringify({ valid: false, message: 'Metadata token tidak valid' }),
{ status: 400, headers: { 'Content-Type': 'application/json' } }
);
}

const createdMs =
typeof createdAtRaw === 'number'
? (createdAtRaw > 1e12 ? createdAtRaw : createdAtRaw * 1000)
: new Date(createdAtRaw).getTime();

const expired = Date.now() > createdMs + lifetimeMinutes * 60_000;

if (expired) {
return new Response(
JSON.stringify({ valid: false, message: 'Token kadaluarsa' }),
{ status: 403, headers: { 'Content-Type': 'application/json' } }
);
}

return new Response(
JSON.stringify({ valid: true, message: 'Token valid' }),
{ status: 200, headers: { 'Content-Type': 'application/json' } }
);
} catch {
return new Response(
JSON.stringify({ valid: false, message: 'Terjadi kesalahan server' }),
{ status: 500, headers: { 'Content-Type': 'application/json' } }
);
}
};
