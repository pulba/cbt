import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { questions, questionAnswers } from "../../../../db/schema";
import * as xlsx from "xlsx";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;
        const topicIdStr = formData.get("topicId") as string;

        if (!file || !topicIdStr) {
            return new Response(JSON.stringify({ success: false, error: "File dan Topik ID wajib disertakan" }), { status: 400 });
        }

        const topicId = parseInt(topicIdStr);
        const fileName = file.name.toLowerCase();
        const buffer = Buffer.from(await file.arrayBuffer());

        let parsedQuestions: any[] = [];

        if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
            parsedQuestions = parseExcel(buffer);
        } else if (fileName.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ buffer });
            parsedQuestions = parseTextHeuristics(result.value);
            if (parsedQuestions.length === 0) {
                parsedQuestions = parseTextRegex(result.value);
            }
        } else if (fileName.endsWith(".pdf")) {
            const data = await pdfParse(buffer);
            parsedQuestions = parseTextHeuristics(data.text);
            if (parsedQuestions.length === 0) {
                parsedQuestions = parseTextRegex(data.text);
            }
        } else {
            return new Response(JSON.stringify({ success: false, error: "Format file tidak didukung. Gunakan .xlsx, .docx, atau .pdf" }), { status: 400 });
        }

        if (parsedQuestions.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "Tidak ada soal yang berhasil diekstrak. Pastikan format penulisan benar." }), { status: 400 });
        }

        // Insert to DB
        let insertCount = 0;
        for (const q of parsedQuestions) {
            // Insert Question
            const insertedQ = await db.insert(questions).values({
                topicId,
                type: 1, // Default Pilihan Ganda for import
                text: q.questionText,
                difficulty: 1,
                isActive: true
            }).returning();

            const newQuestionId = insertedQ[0].id;
            insertCount++;

            // Insert Options
            if (q.options && typeof q.options === 'object') {
                for (const [letter, optText] of Object.entries(q.options)) {
                    // Determine if this is the correct answer
                    const isCorrect = q.answerKey === letter.toUpperCase();

                    await db.insert(questionAnswers).values({
                        questionId: newQuestionId,
                        text: optText as string,
                        isCorrect
                    });
                }
            } else {
                console.warn(`[Import Soal] Warning: q.options is null or not an object for question: ${q.questionText}`);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Berhasil mengimpor ${insertCount} soal.`,
            count: insertCount
        }), { status: 200 });

    } catch (error: any) {
        console.error("Import Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message || "Gagal memproses file upload." }), { status: 500 });
    }
};

/**
 * Excel Parser (Vertical Row Format)
 * Col 0: No
 * Col 1: Jenis (SOAL / JAWABAN)
 * Col 2: Isi (Teks soal atau teks opsi)
 * Col 3: Jawaban (1 untuk benar, 0 untuk salah, hanya pada baris JAWABAN)
 */
function parseExcel(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // header: 1 gives array of arrays
    const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const result = [];
    let currentQuestion: any = null;
    let optionIndex = 0;
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // At least need Jenis and Isi column (index 1 and 2)
        if (!row || row.length < 3) continue;

        const jenisRaw = row[1];
        if (!jenisRaw) continue;

        const jenis = String(jenisRaw).trim().toUpperCase();
        if (jenis !== 'SOAL' && jenis !== 'JAWABAN') continue;

        const isiRaw = row[2];
        const isi = isiRaw ? String(isiRaw).trim().replace(/\r\n/g, "<br/>").replace(/\n/g, "<br/>") : "";

        if (jenis === 'SOAL') {
            if (currentQuestion) {
                result.push(currentQuestion);
            }
            currentQuestion = {
                questionText: isi,
                options: {},
                answerKey: null
            };
            optionIndex = 0;
        } else if (jenis === 'JAWABAN' && currentQuestion) {
            const jawabanVal = row[3];
            const isCorrect = jawabanVal !== undefined && String(jawabanVal).trim() === '1';
            const letter = letters[optionIndex] || 'X';

            currentQuestion.options[letter] = isi;
            if (isCorrect) {
                currentQuestion.answerKey = letter;
            }
            optionIndex++;
        }
    }

    if (currentQuestion) {
        result.push(currentQuestion);
    }

    return result;
}

/**
 * Word/PDF Heuristic Parser (Vertical Table Format)
 * 
 * When Mammoth or PDF-Parse extracts a table, it usually flattens the cells into newlines.
 * Since the user format uses a 4-column layout (No | Jenis | Isi | Jawaban), we will look
 * for the sequence of these cells.
 * 
 * We assume the text looks something like this when flattened:
 * 1 (No, optional if merged)
 * SOAL (Jenis)
 * Teks Pertanyaan (Isi)
 * (Jawaban) -> Might be empty/skipped
 * JAWABAN (Jenis)
 * Teks Opsi A (Isi)
 * 1 (Jawaban)
 * JAWABAN (Jenis)
 * Teks Opsi B (Isi)
 * 0 (Jawaban)
 */
function parseTextHeuristics(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result = [];

    let currentQuestion: any = null;
    let optionIndex = 0;
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip headers if accidentally caught
        if (line.toUpperCase() === 'NO' || line.toUpperCase() === 'JENIS' ||
            line.toUpperCase() === 'ISI') {
            continue;
        }

        // Look for "SOAL" or "JAWABAN" marker
        if (line.toUpperCase() === 'SOAL') {
            // Next line should be the Isi (Question text)
            let qText = "";
            let nextIndex = i + 1;

            // Gather text until we hit another JAWABAN or SOAL marker or end of file
            while (nextIndex < lines.length) {
                const nextLine = lines[nextIndex].toUpperCase();
                if (nextLine === 'JAWABAN' || nextLine === 'SOAL') break;
                // If the line is just a number (like No "2" or Jawaban "0"), and the line *after* it is "SOAL" or "JAWABAN", it might be a stray cell.
                // We do a simple check: if line is exactly a number and next line is a marker, stop gathering.
                if (/^\d+$/.test(lines[nextIndex]) && nextIndex + 1 < lines.length &&
                    (lines[nextIndex + 1].toUpperCase() === 'SOAL' || lines[nextIndex + 1].toUpperCase() === 'JAWABAN')) {
                    break;
                }

                qText += (qText ? "<br/>" : "") + lines[nextIndex];
                nextIndex++;
            }

            if (currentQuestion) result.push(currentQuestion);

            currentQuestion = {
                questionText: qText,
                options: {},
                answerKey: null
            };
            optionIndex = 0;
            i = nextIndex - 1; // Advance loop

        } else if (line.toUpperCase() === 'JAWABAN' && currentQuestion) {
            // Next lines should be Isi (Option text), followed by Jawaban (1 or 0)
            let optText = "";
            let isCorrect = false;
            let nextIndex = i + 1;

            while (nextIndex < lines.length) {
                const nextLine = lines[nextIndex].toUpperCase();
                if (nextLine === 'JAWABAN' || nextLine === 'SOAL') break;

                // Check if this line is strictly "0" or "1", indicating the end of the option cell and start of answer cell
                if (lines[nextIndex] === '0' || lines[nextIndex] === '1') {
                    // But is it the Jawaban column? Usually, yes, if it's the last thing before the next JAWABAN/SOAL marker
                    if (nextIndex + 1 >= lines.length || lines[nextIndex + 1].toUpperCase() === 'JAWABAN' || lines[nextIndex + 1].toUpperCase() === 'SOAL' || /^\d+$/.test(lines[nextIndex + 1])) {
                        isCorrect = lines[nextIndex] === '1';
                        nextIndex++;
                        break;
                    }
                }

                optText += (optText ? "<br/>" : "") + lines[nextIndex];
                nextIndex++;
            }

            const letter = letters[optionIndex] || 'X';
            currentQuestion.options[letter] = optText;
            if (isCorrect) {
                currentQuestion.answerKey = letter;
            }
            optionIndex++;
            i = nextIndex - 1; // Advance loop
        }
    }

    if (currentQuestion) {
        result.push(currentQuestion);
    }

    return result;
}

/**
 * Fallback Parser for Plain Text (Regex)
 * Matches standard formats:
 * 1. Question text
 * A. Option 1
 * B. Option 2
 * Kunci: A
 */
function parseTextRegex(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result = [];

    let currentQuestion: any = null;
    let currentOptionText = "";
    let currentOptionLetter = "";

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Match "1. Pertanyaan" or "2. Pertanyaan"
        const questionMatch = line.match(/^(\d+)\.\s+(.*)/);
        if (questionMatch) {
            // Save previous question
            if (currentQuestion) {
                if (currentOptionLetter && currentOptionText) {
                    currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
                }
                result.push(currentQuestion);
            }

            currentQuestion = {
                questionText: questionMatch[2],
                options: {},
                answerKey: null
            };
            currentOptionLetter = "";
            currentOptionText = "";
            continue;
        }

        // Match "A. Option Text" or "A.Option Text"
        const optionMatch = line.match(/^([A-Ea-e])[\.\)]\s*(.*)/);
        if (optionMatch && currentQuestion) {
            // Save previous option
            if (currentOptionLetter && currentOptionText) {
                currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
            }

            currentOptionLetter = optionMatch[1].toUpperCase();
            currentOptionText = optionMatch[2];
            continue;
        }

        // Match "Kunci: A" or "Kunci Jawaban: A"
        const keyMatch = line.match(/^Kunci(?: Jawaban)?:\s*([A-Ea-e])/i);
        if (keyMatch && currentQuestion) {
            if (currentOptionLetter && currentOptionText) {
                currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
                currentOptionLetter = "";
                currentOptionText = "";
            }
            currentQuestion.answerKey = keyMatch[1].toUpperCase();
            continue;
        }

        // Accumulate multiline text
        if (currentQuestion) {
            if (currentOptionLetter) {
                currentOptionText += "<br/>" + line;
            } else {
                currentQuestion.questionText += "<br/>" + line;
            }
        }
    }

    if (currentQuestion) {
        if (currentOptionLetter && currentOptionText) {
            currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
        }
        result.push(currentQuestion);
    }

    return result;
}
