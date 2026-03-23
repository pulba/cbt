import * as jose from 'jose';
import fs from 'fs';
import { createClient } from '@libsql/client';

const baseUrl = 'http://localhost:4321';

async function runBot() {
    console.log("🤖 Memulai Bot Simulasi Ujian Siswa...");

    // 1. Get DB to find an active test and user
    const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    
    // Cari user U-0001 (Ahmad Rizki Pratama)
    const userRow = await client.execute("SELECT id, username, first_name, group_id FROM users WHERE username = 'U-0001'");
    if(userRow.rows.length === 0) return console.log("User U-0010 tidak ditemukan!");
    const user = userRow.rows[0];

    // Buat JWT Token
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'sas_cbt_secret_key_2024');
    const token = await new jose.SignJWT({ id: Number(user.id), username: String(user.username), role: 'student', groupId: Number(user.group_id) })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(secret);
        
    const cookies = `cbt_student_session=${token}`;
    console.log(`✅ Login sebagai: ${user.first_name} (${user.username})`);

    // 2. Cari Ujian yang tersedia (Ujian Robot Matematika = 13)
    const testId = 13;
    
    // Cek apakah belum ada test_users (bikin kalau belum ada)
    let sessionRow = await client.execute({ sql: "SELECT id FROM test_users WHERE user_id = ? AND test_id = ? ORDER BY id DESC LIMIT 1", args: [Number(user.id), testId] });
    let sessionId;
    
    if (sessionRow.rows.length === 0) {
        console.log("Membuat Sesi Ujian Baru...");
        const genRes = await fetch(`${baseUrl}/api/peserta/generate-soal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookies },
            body: JSON.stringify({ testId })
        });
        const genData = await genRes.json();
        console.log("Generate Soal Response:", genData);
        if(genData.status !== 1) return console.log("Gagal generate soal");
        
        const newSessionRow = await client.execute({ sql: "SELECT id FROM test_users WHERE user_id = ? AND test_id = ? ORDER BY id DESC LIMIT 1", args: [Number(user.id), testId] });
        sessionId = Number(newSessionRow.rows[0].id);
    } else {
        sessionId = Number(sessionRow.rows[0].id);
        console.log("Memakai Sesi Ujian Lama ID:", sessionId);
    }
    
    // 3. Update status = 1 (mengerjakan) just in case
    await client.execute({ sql: "UPDATE test_users SET status = 1 WHERE id = ?", args: [sessionId] });

    // 4. Ambil semua soal dari test_questions untuk sesi ini
    const qs = await client.execute({ sql: "SELECT id, question_id FROM test_questions WHERE test_user_id = ?", args: [sessionId] });
    console.log(`✅ Mendapatkan ${qs.rows.length} soal untuk dikerjakan...`);

    // 5. Jawab semua soal
    for (let i = 0; i < qs.rows.length; i++) {
        const tqId = Number(qs.rows[i].id);
        
        // Pilih opsi yang BENAR (is_correct dari bank soal)
        const opts = await client.execute({ 
            sql: `SELECT tqa.answer_id FROM test_question_answers tqa 
                  JOIN question_answers qa ON tqa.answer_id = qa.id 
                  WHERE tqa.test_question_id = ? AND qa.is_correct = 1`, 
            args: [tqId] 
        });
        
        if (opts.rows.length > 0) {
            const ansId = Number(opts.rows[0].answer_id);
            console.log(`📥 Menjawab soal ${i+1}/${qs.rows.length} (TQ: ${tqId}) dengan Jawaban BENAR: ${ansId}...`);

            // PANGGIL POST API SISWA! 
            const ansRes = await fetch(`${baseUrl}/api/peserta/simpan-jawaban`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': cookies },
                body: JSON.stringify({ action: 'answer', testQuestionId: tqId, answerId: ansId })
            });
            const text = await ansRes.text();
            if(!text.includes('"status":1')) {
                console.error(`❌ GAGAL MENJAWAB:`, text);
                return;
            }
        }
    }

    console.log(`✅ Selesai menjawab semua ${qs.rows.length} soal! Mensubmit Ujian...`);

    // 6. Panggil endpoint HTTP Selesai yang akan mengkalkulasi skor
    const finRes = await fetch(`${baseUrl}/api/peserta/selesai?sessionId=${sessionId}`, {
        headers: { 'Cookie': cookies }
    });
    console.log(`🏁 Submit redirect status: ${finRes.status}`);

    // 7. Cek hasil akhir di database untuk divalidasi
    const finalQ = await client.execute({ sql: "SELECT sum(score) as total_score, count(is_answered) as answered FROM test_questions WHERE test_user_id = ?", args: [sessionId] });
    
    const countTotal = Number(finalQ.rows[0].total_score);
    console.log(`\n🎉 BUKTI UJIAN SELESAI & TERSIMPAN:`);
    console.log(`- Soal Terekam Dijawab: ${finalQ.rows[0].answered}`);
    console.log(`- Skor Mentah di Server: ${countTotal}`);
    console.log(`\n🚀 Silakan cek Rekapitulasi Nilai sekarang, data Ahmad Rizki Pratama (U-0001) PASTI muncul dengan nilai 100!`);

    client.close();
}

runBot().catch(e => console.error(e));
