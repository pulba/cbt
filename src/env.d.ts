/// <reference types="astro/client" />

interface UserPayload {
    id: number;
    username: string;
    role: 'student' | 'admin' | 'guru' | 'operator';
    groupId?: number;
}

declare namespace App {
    interface Locals {
        user: UserPayload;
    }
}
