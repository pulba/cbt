import type { APIRoute } from "astro";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { names, groupId } = body;

        if (!names || !Array.isArray(names) || names.length === 0 || !groupId) {
            return new Response(JSON.stringify({ success: false, error: "Daftar nama dan Grup wajib diisi" }), { status: 400 });
        }

        // Fetch all existing usernames to determine the next U-XXXX sequence
        const existingUsers = await db.select({ username: users.username }).from(users).all();
        const existingUsernames = new Set(existingUsers.map(u => u.username));

        let nextSequenceNumber = 1;
        // Find highest existing U-XXXX number
        for (const un of existingUsernames) {
            if (un.startsWith('U-')) {
                const num = parseInt(un.substring(2));
                if (!isNaN(num) && num >= nextSequenceNumber) {
                    nextSequenceNumber = num + 1;
                }
            }
        }

        const newUsers = [];

        for (const name of names) {
            const cleanName = name.trim();
            if (!cleanName) continue;

            // Generate Username (U-XXXX) format, padding with zeros
            let username = `U-${String(nextSequenceNumber).padStart(4, '0')}`;
            while (existingUsernames.has(username)) {
                nextSequenceNumber++;
                username = `U-${String(nextSequenceNumber).padStart(4, '0')}`;
            }
            existingUsernames.add(username);
            nextSequenceNumber++;

            // Generate random 5 digit password
            const password = String(Math.floor(10000 + Math.random() * 90000));

            newUsers.push({
                username,
                password,
                firstName: cleanName,
                groupId: parseInt(groupId),
                detail: "Auto-generated"
            });
        }

        if (newUsers.length > 0) {
            await db.insert(users).values(newUsers);
        }

        return new Response(JSON.stringify({ success: true, count: newUsers.length, users: newUsers }), { status: 201 });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
};
