import type { APIRoute } from 'astro';
import { db } from '../../../db';
import { tests, testUsers, testQuestions, testQuestionAnswers, questionAnswers, users, userGroups, questions, essayConfigs } from '../../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
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

        // 3. Get all session questions for exact scoring
        const allSessionQuestions = await db
            .select({
                sessionId: testQuestions.testUserId,
                qId: testQuestions.id,
                questionId: testQuestions.questionId,
                score: testQuestions.score,
                qType: questions.type,
                essayMaxScore: essayConfigs.maxScore
            })
            .from(testQuestions)
            .innerJoin(testUsers, eq(testQuestions.testUserId, testUsers.id))
            .innerJoin(questions, eq(testQuestions.questionId, questions.id))
            .leftJoin(essayConfigs, eq(testQuestions.questionId, essayConfigs.questionId))
            .where(eq(testUsers.testId, testId))
            .all();

        // Fetch weights for Type 4 questions to calculate max possible raw score
        const type4QuestionIds = [...new Set(allSessionQuestions.filter(q => q.qType === 4).map(q => q.questionId))];
        const type4Weights = new Map<number, number>();
        if (type4QuestionIds.length > 0) {
            const weights = await db.select({ qId: questionAnswers.questionId, weight: questionAnswers.weight })
                .from(questionAnswers).where(inArray(questionAnswers.questionId, type4QuestionIds as number[])).all();
            type4QuestionIds.forEach(qid => {
                const totalW = weights.filter(w => w.qId === qid).reduce((s, w) => s + (w.weight ?? 1), 0);
                type4Weights.set(qid, totalW);
            });
        }

        const scoreRight = test.scoreRight ?? 1;
        const maxScore = test.maxScore ?? 0;

        // 4. Prepare data for Excel
        const data = sessions.map((sess, idx) => {
            const sessionQs = allSessionQuestions.filter(q => q.sessionId === sess.sessionId);
            
            const total = sessionQs.length;
            const earnedRaw = sessionQs.reduce((sum, q) => sum + (q.score || 0), 0);
            
            // Calculate what a "perfect" raw score would be for this specific student's question set
            const maxRaw = sessionQs.reduce((sum, q) => {
                if (q.qType === 2 || q.qType === 3) return sum + (q.essayMaxScore ?? 100);
                if (q.qType === 4) return sum + (type4Weights.get(q.questionId) ?? 1);
                return sum + scoreRight;
            }, 0);

            const maxScale = maxScore > 0 ? maxScore : 100;
            const finalScore = maxRaw > 0 ? (earnedRaw / maxRaw) * maxScale : 0;

            // Simplified counts for Excel (PG and PGK)
            const correct = sessionQs.filter(q => (q.qType === 1 || q.qType === 5) && q.score && q.score > 0).length;
            const wrong = sessionQs.filter(q => (q.qType === 1 || q.qType === 5) && q.score === 0).length;
            const empty = total - (sessionQs.filter(q => q.score !== null).length); // Approximate

            return {
                "No": idx + 1,
                "Nama": sess.firstName,
                "Username": sess.username,
                "Group / Kelas": sess.groupName || '-',
                "Status": sess.status === 4 ? 'Selesai' : 'Berlangsung',
                "Benar": correct,
                "Salah": wrong,
                "Kosong": total - (correct + wrong), 
                "Total Soal": total,
                "Nilai": Math.round(finalScore * 100) / 100
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
