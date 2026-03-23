import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
    console.log("🚀 Setting up Math Questions and Test...");

    // 1. Create Topic
    const topicRes = await client.execute({
        sql: "INSERT INTO topics (name, description, status) VALUES (?, ?, ?) RETURNING id",
        args: ["Matematika Robot", "Kumpulan soal matematika untuk uji coba bot", 1]
    });
    const topicId = Number(topicRes.rows[0].id);
    console.log(`✅ Topic Created: ID ${topicId}`);

    // 2. Create 10 Questions
    const mathQuestions = [
        { q: "Berapakah 5 + 7?", a: ["10", "11", "12", "13", "14"], c: "12" },
        { q: "Berapakah 15 - 8?", a: ["5", "6", "7", "8", "9"], c: "7" },
        { q: "Berapakah 4 x 6?", a: ["20", "22", "24", "26", "28"], c: "24" },
        { q: "Berapakah 81 / 9?", a: ["7", "8", "9", "10", "11"], c: "9" },
        { q: "Akar dari 64 adalah?", a: ["6", "7", "8", "9", "10"], c: "8" },
        { q: "Berapakah 12 + 18?", a: ["25", "28", "30", "32", "35"], c: "30" },
        { q: "Berapakah 100 / 4?", a: ["20", "25", "30", "35", "40"], c: "25" },
        { q: "Berapakah 3 pangkat 3?", a: ["9", "18", "21", "24", "27"], c: "27" },
        { q: "Berapakah 1/2 dari 50?", a: ["20", "22.5", "25", "27.5", "30"], c: "25" },
        { q: "Berapakah 10% dari 200?", a: ["10", "15", "20", "25", "30"], c: "20" }
    ];

    for (const item of mathQuestions) {
        const qRes = await client.execute({
            sql: "INSERT INTO questions (topic_id, type, text, difficulty, is_active) VALUES (?, 1, ?, 1, 1) RETURNING id",
            args: [topicId, `<p>${item.q}</p>`]
        });
        const qId = Number(qRes.rows[0].id);

        for (const ansText of item.a) {
            await client.execute({
                sql: "INSERT INTO question_answers (question_id, text, is_correct) VALUES (?, ?, ?)",
                args: [qId, ansText, ansText === item.c ? 1 : 0]
            });
        }
    }
    console.log(`✅ 10 Questions with answers inserted.`);

    // 3. Create Test
    const testRes = await client.execute({
        sql: "INSERT INTO tests (name, detail, score_right, score_wrong, score_unanswered, max_score, is_active) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        args: ["Ujian Robot Matematika", "Tes simulasi 10 soal matematika", 10, 0, 0, 100, 1]
    });
    const testId = Number(testRes.rows[0].id);
    console.log(`✅ Test Created: ID ${testId}`);

    // 4. Link Test to Group 1 (Kelas X)
    await client.execute({
        sql: "INSERT INTO test_groups (test_id, group_id) VALUES (?, ?)",
        args: [testId, 1]
    });
    console.log(`✅ Test linked to Group 1 (Kelas X).`);

    // 5. Create Blueprint
    await client.execute({
        sql: "INSERT INTO test_topic_sets (test_id, topic_id, question_type, question_count, shuffle_questions, shuffle_answers, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [testId, topicId, 1, 10, 1, 1, 30]
    });
    console.log(`✅ Blueprint created for 10 questions.`);

    console.log(`\n🎉 SETUP COMPLETE! Test ID: ${testId}`);
    client.close();
}

main().catch(console.error);
