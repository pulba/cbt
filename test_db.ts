import { db } from "./src/db/index.js";
import { questions } from "./src/db/schema.js";
import { eq } from "drizzle-orm";

async function run() {
    console.log("Fetching id 40...");
    const soal = await db.select().from(questions).where(eq(questions.id, 40)).get();
    console.log("Result:", soal);
}
run();
