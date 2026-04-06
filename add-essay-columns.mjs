/**
 * Migration: Add essay grading support
 * Run with: node add-essay-columns.mjs
 * 
 * Safe to run multiple times (checks existence first)
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config();

const client = createClient({
    url: process.env.TURSO_DATABASE_URL || "",
    authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function run() {
    console.log("🔄 Running essay grading migration...\n");

    // 1. Add columns to test_questions
    const tqColumns = [
        "ALTER TABLE test_questions ADD COLUMN essay_score_override REAL",
        "ALTER TABLE test_questions ADD COLUMN essay_graded_by INTEGER",
        "ALTER TABLE test_questions ADD COLUMN essay_graded_at INTEGER",
        "ALTER TABLE test_questions ADD COLUMN essay_notes TEXT",
    ];

    for (const sql of tqColumns) {
        try {
            await client.execute(sql);
            console.log(`✅ ${sql}`);
        } catch (e) {
            if (e.message?.includes("duplicate column name") || e.message?.includes("already exists")) {
                console.log(`⏭️  Skipped (already exists): ${sql.split("ADD COLUMN")[1].trim()}`);
            } else {
                console.error(`❌ Error: ${e.message}`);
            }
        }
    }

    // 2. Create essay_configs table
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS essay_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id INTEGER NOT NULL UNIQUE REFERENCES questions(id),
                correct_answer TEXT,
                keywords TEXT DEFAULT '[]',
                grading_mode TEXT DEFAULT 'manual',
                max_score REAL DEFAULT 100
            )
        `);
        console.log("✅ Table essay_configs created (or already exists)");
    } catch (e) {
        console.error(`❌ Error creating essay_configs: ${e.message}`);
    }

    console.log("\n✅ Migration completed!");
    process.exit(0);
}

run().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});
