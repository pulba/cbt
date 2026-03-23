import * as jose from 'jose';

export type UserPayload = {
id: number;
username: string;
role: 'student' | 'admin' | 'guru' | 'operator';
groupId?: number; // For students
};

const jwtSecret = import.meta.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim().length < 32) {
throw new Error('JWT_SECRET wajib diisi dan minimal 32 karakter.');
}

const SECRET_KEY = new TextEncoder().encode(jwtSecret);
const JWT_EXPIRES_IN = import.meta.env.JWT_EXPIRES_IN || '1d';

export async function signToken(payload: UserPayload): Promise<string> {
return await new jose.SignJWT(payload)
.setProtectedHeader({ alg: 'HS256' })
.setIssuedAt()
.setExpirationTime(JWT_EXPIRES_IN)
.sign(SECRET_KEY);
}

export async function verifyToken(token: string): Promise<UserPayload | null> {
try {
const { payload } = await jose.jwtVerify(token, SECRET_KEY);
return payload as UserPayload;
} catch {
return null;
}
}
