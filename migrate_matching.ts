import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
dotenv.config();

const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run() {
    console.log("Adding match_right...");
    try { 
        await client.execute('ALTER TABLE question_answers ADD COLUMN match_right TEXT;');
        console.log("Success: match_right added");
    } catch(e: any) { 
        console.log("Warning/Exists match_right:", e.message); 
    }
    
    console.log("Adding weight...");
    try { 
        await client.execute('ALTER TABLE question_answers ADD COLUMN weight REAL DEFAULT 1;'); 
        console.log("Success: weight added");
    } catch(e: any) { 
        console.log("Warning/Exists weight:", e.message); 
    }
    console.log("Migration complete");
}
run();
