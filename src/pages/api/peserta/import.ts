import type { APIRoute } from "astro";
import { db } from "../../../db";
import { users, userGroups } from "../../../db/schema";
import { eq, inArray } from "drizzle-orm";
import * as xlsx from "xlsx";

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return new Response(JSON.stringify({ success: false, error: "File excel tidak ditemukan" }), { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Parse sheet to JSON array of arrays (header in row 1)
        const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) {
            return new Response(JSON.stringify({ success: false, error: "Isi file kosong atau format tidak sesuai" }), { status: 400 });
        }

        const dataRows = rows.slice(1); // skip header
        let successCount = 0;
        let failCount = 0;
        let errors: string[] = [];

        // Pre-fetch all groups for faster lookup
        const groups = await db.select().from(userGroups).all();
        const groupMap: Record<string, number> = {};
        groups.forEach(g => groupMap[g.name.trim().toLowerCase()] = g.id);

        // Pre-fetch all usernames to check duplicate
        const allUsers = await db.select({ username: users.username }).from(users).all();
        const usernameSet = new Set(allUsers.map(u => u.username));

        const batchInsertData = [];

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const originalRowNumber = i + 2;

            // Pastikan baris memiliki data minimal Username
            if (!row || row.length === 0 || (!row[0] && !row[1] && !row[2])) {
                continue;
            }

            const username = String(row[0] || "").trim();
            const password = String(row[1] || "").trim();
            const firstName = String(row[2] || "").trim();
            const email = String(row[3] || "").trim();
            const groupName = String(row[4] || "").trim();
            const detail = String(row[5] || "").trim();

            if (!username) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Username kosong.`);
                continue;
            }
            if (!password) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Password kosong untuk username ${username}.`);
                continue;
            }
            if (!firstName) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Nama kosong untuk username ${username}.`);
                continue;
            }
            if (!groupName) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Nama Grup kosong untuk username ${username}.`);
                continue;
            }

            // Validasi Group Exists
            const groupId = groupMap[groupName.toLowerCase()];
            if (!groupId) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Group "${groupName}" belum dibuat di database.`);
                continue;
            }

            // Validasi Duplicate Username
            if (usernameSet.has(username)) {
                failCount++;
                errors.push(`Baris ${originalRowNumber}: Username "${username}" sudah digunakan.`);
                continue;
            }

            batchInsertData.push({
                username,
                password, // Clear text per requirement
                firstName,
                email: email || null,
                groupId,
                detail: detail || null
            });

            // add to set so inside this batch we don't have duplicates either
            usernameSet.add(username);
            successCount++;
        }

        if (batchInsertData.length > 0) {
            await db.insert(users).values(batchInsertData);
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Proses import selesai. Berhasil: ${successCount}, Gagal: ${failCount}`,
            errors
        }), { status: 200 });

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: "Terjadi kesalahan saat parsing file: " + error.message }), { status: 500 });
    }
};
