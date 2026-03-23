import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { tests, testUsers, testQuestions, testQuestionAnswers, questionAnswers, users, userGroups } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
import * as XLSX from 'xlsx';

export const GET: APIRoute = async ({ request, locals }) => {
    try {
        const admin = locals.user;
        if (!admin || admin.role === 'student') {
            return new Response('Unauthorized', { status: 401 });
        }

        const url = new URL(request.url);
        const testIdStr = url.searchParams.get('testId');
        if (!testIdStr) return new Response('Missing testId', { status: 400 });
        
        const testId = parseInt(testIdStr);

        // 1. Get test config
        const test = await db.select().from(tests).where(eq(tests.id, testId)).get();
        if (!test) return new Response('Test not found', { status: 404 });

        // 2. Get all sessions
        const sessions = await db
            .select({
                sessionId: testUsers.id,
                userId: testUsers.userId,
                creationTime: testUsers.creationTime,
                firstName: users.firstName,
                username: users.username,
                groupName: userGroups.name,
                status: testUsers.status,
            })
            .from(testUsers)
            .innerJoin(users, eq(testUsers.userId, users.id))
            .leftJoin(userGroups, eq(users.groupId, userGroups.id))
            .where(eq(testUsers.testId, testId))
            .orderBy(userGroups.name, users.firstName)
            .all();

        // 3. Get all session questions and answers for bulk scoring
        const allSessionQuestions = await db
            .select({
                sessionId: testQuestions.testUserId,
                qId: testQuestions.id,
            })
            .from(testQuestions)
            .innerJoin(testUsers, eq(testQuestions.testUserId, testUsers.id))
            .where(eq(testUsers.testId, testId))
            .all();

        const allSessionSelected = await db
            .select({
                sessionId: testQuestions.testUserId,
                isCorrect: questionAnswers.isCorrect,
            })
            .from(testQuestionAnswers)
            .innerJoin(testQuestions, eq(testQuestionAnswers.testQuestionId, testQuestions.id))
            .innerJoin(testUsers, eq(testQuestions.testUserId, testUsers.id))
            .innerJoin(questionAnswers, eq(testQuestionAnswers.answerId, questionAnswers.id))
            .where(and(
                eq(testUsers.testId, testId),
                eq(testQuestionAnswers.isSelected, true)
            ))
            .all();

        const scoreRight = test.scoreRight ?? 1;
        const scoreWrong = test.scoreWrong ?? 0;
        const scoreUnanswered = test.scoreUnanswered ?? 0;
        const maxScore = test.maxScore ?? 0;

        // 4. Prepare data for Excel
        const data = sessions.map((sess, idx) => {
            const sessionQs = allSessionQuestions.filter(q => q.sessionId === sess.sessionId);
            const sessionSelected = allSessionSelected.filter(s => s.sessionId === sess.sessionId);

            const total = sessionQs.length;
            const correct = sessionSelected.filter(s => s.isCorrect).length;
            const answered = sessionSelected.length;
            const wrong = answered - correct;
            const unanswered = total - answered;

            const pgScore = (correct * scoreRight) + (wrong * scoreWrong) + (unanswered * scoreUnanswered);
            const maxScoreScale = maxScore > 0 ? maxScore : 100;
            const maxRaw = total * scoreRight;
            const totalScore = maxRaw > 0 ? (pgScore / maxRaw) * maxScoreScale : 0;

            return {
                "No": idx + 1,
                "Nama": sess.firstName,
                "Username": sess.username,
                "Group / Kelas": sess.groupName || '-',
                "Status": sess.status === 4 ? 'Selesai' : 'Berlangsung',
                "Benar": correct,
                "Salah": wrong,
                "Kosong": unanswered,
                "Total Soal": total,
                "Nilai": totalScore
            };
        });

        // 5. Build Excel File
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Hasil Ujian");

        // Set column widths
        const wscols = [
            { wch: 5 },  // No
            { wch: 30 }, // Nama
            { wch: 20 }, // Username
            { wch: 20 }, // Group/Kelas
            { wch: 12 }, // Status
            { wch: 8 },  // Benar
            { wch: 8 },  // Salah
            { wch: 8 },  // Kosong
            { wch: 12 }, // Total Soal
            { wch: 10 }, // Nilai
        ];
        worksheet['!cols'] = wscols;

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const filename = `Hasil_${test.name.replace(/\s+/g, '_')}_${new Date().getTime()}.xlsx`;

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
            }
        });

    } catch (error) {
        console.error("Export Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};
