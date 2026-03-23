import * as jose from 'jose';

export type UserPayload = {
id: number;
username: string;
role: 'student' | 'admin' | 'guru' | 'operator';
groupId?: number; // For students
};

function getSecret(customSecret?: string) {
    const jwtSecret = customSecret || import.meta.env.JWT_SECRET || (globalThis as any).process?.env?.JWT_SECRET;
    if (!jwtSecret || jwtSecret.trim().length < 32) {
        // Jangan throw di top-level agar tidak crash di Cloudflare saat build
        return null;
    }
    return new TextEncoder().encode(jwtSecret);
}

const JWT_EXPIRES_IN = import.meta.env.JWT_EXPIRES_IN || '1d';

export async function signToken(payload: UserPayload, customSecret?: string): Promise<string> {
    const SECRET_KEY = getSecret(customSecret);
    if (!SECRET_KEY) throw new Error('JWT_SECRET wajib diisi dan minimal 32 karakter.');
    
    return await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(JWT_EXPIRES_IN)
        .sign(SECRET_KEY);
}

export async function verifyToken(token: string, customSecret?: string): Promise<UserPayload | null> {
    try {
        const SECRET_KEY = getSecret(customSecret);
        if (!SECRET_KEY) return null;
        
        const { payload } = await jose.jwtVerify(token, SECRET_KEY);
        return payload as UserPayload;
    } catch {
        return null;
    }
}
