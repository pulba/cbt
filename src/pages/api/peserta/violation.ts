import type { APIRoute } from "astro";
import { db } from "../../../db";
import { testUsers } from "../../../db/schema";
import { eq, and, sql } from "drizzle-orm";

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const user = locals.user;
        if (!user || user.role !== 'student') {
            return new Response(JSON.stringify({ status: 0, message: "Unauthorized" }), { status: 401 });
        }

        const body = await request.json();
        const { testId } = body;

        if (!testId) {
            return new Response(JSON.stringify({ status: 0, message: "Missing testId" }), { status: 400 });
        }

        // Fetch current session
        const session = await db.select()
            .from(testUsers)
            .where(
                and(
                    eq(testUsers.testId, parseInt(testId)),
                    eq(testUsers.userId, user.id),
                    sql`${testUsers.status} < 4` // Still active
                )
            ).get();

        if (!session) {
            return new Response(JSON.stringify({ status: 0, message: "No active session found" }), { status: 404 });
        }

        const newViolationCount = (session.violationCount || 0) + 1;
        let newStatus = session.status;

        // Lock if 3 violations reached
        if (newViolationCount >= 3) {
            newStatus = 10; // Locked Status
        }

        await db.update(testUsers)
            .set({ 
                violationCount: newViolationCount,
                status: newStatus 
            })
            .where(eq(testUsers.id, session.id));

        return new Response(JSON.stringify({ 
            status: 1, 
            violationCount: newViolationCount,
            isLocked: newStatus === 10
        }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error("Violation Update Error:", error);
        return new Response(JSON.stringify({ status: 0, message: "Server error" }), { status: 500 });
    }
};
