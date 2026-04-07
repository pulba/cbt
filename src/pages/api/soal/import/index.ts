import type { APIRoute } from "astro";
import { db } from "../../../../db";
import { questions, questionAnswers, essayConfigs } from "../../../../db/schema";
import * as xlsx from "xlsx";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import AdmZip from "adm-zip";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Indonesian Stopwords List
const INDONESIAN_STOPWORDS = new Set([
    "dan", "atau", "tetapi", "namun", "sedangkan", "sehingga", "maka", "karena", "sebab",
    "jika", "kalau", "apabila", "walaupun", "meskipun", "kendati", "agar", "supaya", "untuk",
    "dengan", "kecuali", "serta", "lalu", "kemudian", "selanjutnya", "sebelum", "sesudah",
    "setelah", "sejak", "ketika", "tatkala", "sementara", "selagi", "sambil", "seraya",
    "di", "ke", "dari", "pada", "kepada", "bagi", "tentang", "mengenai", "terhadap", "sebagai",
    "seperti", "bagaikan", "laksana", "adalah", "ialah", "merupakan", "yaitu", "yakni",
    "bahwa", "yang", "ini", "itu", "tersebut", "suatu", "sebuah", "seorang", "seekor",
    "ada", "tidak", "bukan", "belum", "jangan", "sangat", "paling", "sekali", "agak",
    "sedikit", "banyak", "semua", "seluruh", "sebagian", "beberapa", "setiap", "masing-masing",
    "hal", "cara", "apa", "siapa", "mengapa", "kenapa", "bagaimana", "mana", "kapan", "dimana",
    "bisa", "dapat", "mampu", "akan", "harus", "wajib", "perlu", "boleh", "mungkin",
    "sudah", "telah", "pernah", "sedang", "masih", "baru", "saja"
]);

function extractKeywords(text: string): string {
    if (!text) return "[]";
    
    // Clean text: lowercase, remove punctuation, split by whitespace
    const words = text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !INDONESIAN_STOPWORDS.has(w));
    
    if (words.length === 0) return "[]";
    
    // Get unique words and distribute score evenly
    const uniqueWords = [...new Set(words)];
    const count = uniqueWords.length;
    const baseScore = Math.floor(100 / count);
    const remainder = 100 % count;
    
    const keywordsArray = uniqueWords.map((word, index) => ({
        word: word,
        score: baseScore + (index < remainder ? 1 : 0)
    }));
    
    return JSON.stringify(keywordsArray);
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const editorHtml = formData.get("editorHtml") as string | null;
        const topicIdStr = formData.get("topicId") as string;
        const questionTypeStr = formData.get("questionType") as string || "1";
        const gradingMode = formData.get("gradingMode") as string || "manual";
        const essayMaxScoreStr = formData.get("essayMaxScore") as string || "100";

        if (!topicIdStr) {
            return new Response(JSON.stringify({ success: false, error: "Topik ID wajib disertakan" }), { status: 400 });
        }

        if (!file && !editorHtml) {
            return new Response(JSON.stringify({ success: false, error: "File atau konten editor wajib disertakan" }), { status: 400 });
        }

        const topicId = parseInt(topicIdStr);
        const questionType = parseInt(questionTypeStr) || 1;
        const isEssay = questionType === 2 || questionType === 3;
        const isMatching = questionType === 4;
        const isCeklis = questionType === 5;
        const isBenarSalah = questionType === 6;
        const essayMaxScore = parseFloat(essayMaxScoreStr) || 100;

        let parsedQuestions: any[] = [];

        // ─── MODE 1: Smart Paste (editorHtml from Quill) ───
        if (editorHtml) {
            // Convert the pasted HTML to text format the parsers understand
            let textValue = htmlToTextWithNumbers(editorHtml);

            if (questionType === 7) {
                parsedQuestions = parseMixedFormat(textValue);
            } else if (isMatching) {
                parsedQuestions = parseTextMatching(textValue);
            } else if (isEssay) {
                parsedQuestions = parseTextEssay(textValue);
            } else if (isBenarSalah) {
                parsedQuestions = parseTextBenarSalah(textValue);
            } else if (isCeklis) {
                parsedQuestions = parseTextCeklis(textValue);
            } else {
                parsedQuestions = parseTextHeuristics(textValue);
                if (parsedQuestions.length === 0) {
                    parsedQuestions = parseTextRegex(textValue);
                }
            }
        }
        // ─── MODE 2: File Upload ───
        else if (file) {
        const fileName = file.name.toLowerCase();
        const buffer = Buffer.from(await file.arrayBuffer());

        if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
            if (isMatching) {
                parsedQuestions = parseExcelMatching(buffer);
            } else if (isEssay) {
                parsedQuestions = parseExcelEssay(buffer);
            } else if (isBenarSalah) {
                parsedQuestions = parseExcelBenarSalah(buffer);
            } else {
                // PG, Ceklis (Type 5) use same excel format but answer key can be multi
                parsedQuestions = parseExcel(buffer);
            }
        } else if (fileName.endsWith(".docx")) {
            let modifiedBuffer = buffer;
            try {
                const zip = new AdmZip(buffer);
                let xml = zip.readAsText("word/document.xml");
                let relsXml = zip.readAsText("word/_rels/document.xml.rels");
                
                // 1. Extract Images
                const relMap: Record<string, string> = {};
                if (relsXml) {
                    relsXml.replace(/<Relationship\b([^>]+)>/gi, (m: any, attrs: string) => {
                        const idMatch = attrs.match(/Id="([^"]+)"/i);
                        const targetMatch = attrs.match(/Target="([^"]+)"/i);
                        if (idMatch && targetMatch) {
                            relMap[idMatch[1]] = targetMatch[1];
                        }
                        return m;
                    });
                }

                zip.getEntries().forEach(entry => {
                    if (entry.entryName.startsWith("word/media/") && !entry.isDirectory) {
                        const baseName = path.basename(entry.entryName);
                        const uploadDir = "./public/uploads/soal";
                        if (!fs.existsSync(uploadDir)) {
                            fs.mkdirSync(uploadDir, { recursive: true });
                        }
                        fs.writeFileSync(path.join(uploadDir, baseName), entry.getData());
                    }
                });

                if (xml) {
                    let hasMod = false;
                    
                    // 2. Parse Floating & Inline Images natively to bypass mammoth restrictions on anchors
                    xml = xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/gi, (match: any, pAttrs: string, inner: string) => {
                        let imgTags = "";
                        
                        // Extract all blip/imagedata matches without replacing them yet
                        const imgMatches = [...inner.matchAll(/(?:a:blip|v:imagedata)\b[^>]*?(?:r:embed|r:id)="([^"]+)"/gi)];
                        for (const m of imgMatches) {
                            const rId = m[1];
                            const target = relMap[rId];
                            if (target) {
                                hasMod = true;
                                const fileName = path.basename(target);
                                imgTags += `[IMG]/uploads/soal/${fileName}[/IMG]`;
                            }
                        }

                        if (imgTags) {
                            // Erase original drawing nodes to avoid mammoth double-parsing or breaking
                            let cleanInner = inner.replace(/<(?:w:drawing|w:pict|mc:AlternateContent)\b[\s\S]*?<\/(?:w:drawing|w:pict|mc:AlternateContent)>/gi, "");
                            cleanInner = cleanInner.replace(/<(?:w:drawing|w:pict|mc:AlternateContent)\b[^>]*?\/>/gi, "");
                            
                            return `<w:p${pAttrs}>${cleanInner}<w:r><w:t xml:space="preserve">${imgTags}</w:t></w:r></w:p>`;
                        }
                        return match;
                    });

                    // 3. Parse OMML
                    xml = xml.replace(/<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/g, (match) => {
                        hasMod = true;
                        let latex = match;
                        
                        // 1. Extract <m:t> text content without accidentally matching properties like <m:type>
                        latex = latex.replace(/<m:t(?:>| [^>]*>)([\s\S]*?)<\/m:t>/g, "$1");
                        // 2. Strip unnecessary wrapper tags like <m:r> but do not consume interior text
                        latex = latex.replace(/<\/?m:r(?:>| [^>]*>)/g, "");
                        latex = latex.replace(/<m:ctrlPr[^>]*>[\s\S]*?<\/m:ctrlPr>/g, "");
                        latex = latex.replace(/<m:rPr[^>]*>[\s\S]*?<\/m:rPr>/g, "");
                        
                        // 3. Strip structural properties that have no LaTeX equivalent
                        latex = latex.replace(/<m:fPr[^>]*>[\s\S]*?<\/m:fPr>/g, "");
                        latex = latex.replace(/<m:radPr[^>]*>[\s\S]*?<\/m:radPr>/g, "");
                        latex = latex.replace(/<m:dPr[^>]*>[\s\S]*?<\/m:dPr>/g, "");
                        latex = latex.replace(/<m:sSupPr[^>]*>[\s\S]*?<\/m:sSupPr>/g, "");
                        latex = latex.replace(/<m:sSubPr[^>]*>[\s\S]*?<\/m:sSubPr>/g, "");
                        latex = latex.replace(/<m:sSubSupPr[^>]*>[\s\S]*?<\/m:sSubSupPr>/g, "");
                        latex = latex.replace(/<m:degHide[^>]*>/g, "");
                        latex = latex.replace(/<m:eqArrPr[^>]*>[\s\S]*?<\/m:eqArrPr>/g, "");

                        // 4. Transform specific block elements before structural replacements
                        latex = latex.replace(/<m:eqArr[^>]*>([\s\S]*?)<\/m:eqArr>/g, (match, inner) => {
                            return "\\begin{matrix}" + inner.replace(/<\/m:e>\s*<m:e[^>]*>/g, "</m:e>\\\\<m:e>") + "\\end{matrix}";
                        });

                        // 5. Transform all structured containers into TeX tags and brackets
                        latex = latex.replace(/<m:f(?:>| [^>]*>)/g, "\\frac");
                        latex = latex.replace(/<\/m:f>/g, "");
                        latex = latex.replace(/<m:num(?:>| [^>]*>)/g, "{");
                        latex = latex.replace(/<\/m:num>/g, "}");
                        latex = latex.replace(/<m:den(?:>| [^>]*>)/g, "{");
                        latex = latex.replace(/<\/m:den>/g, "}");

                        latex = latex.replace(/<m:rad(?:>| [^>]*>)/g, "\\sqrt");
                        latex = latex.replace(/<\/m:rad>/g, "");
                        latex = latex.replace(/<m:deg(?:>| [^>]*>)/g, "[");
                        latex = latex.replace(/<\/m:deg>/g, "]");

                        latex = latex.replace(/<m:sSup(?:>| [^>]*>)/g, "");
                        latex = latex.replace(/<\/m:sSup>/g, "");
                        latex = latex.replace(/<m:sSub(?:>| [^>]*>)/g, "");
                        latex = latex.replace(/<\/m:sSub>/g, "");
                        latex = latex.replace(/<m:sSubSup(?:>| [^>]*>)/g, "");
                        latex = latex.replace(/<\/m:sSubSup>/g, "");

                        latex = latex.replace(/<m:sup(?:>| [^>]*>)/g, "^{");
                        latex = latex.replace(/<\/m:sup>/g, "}");
                        latex = latex.replace(/<m:sub(?:>| [^>]*>)/g, "_{");
                        latex = latex.replace(/<\/m:sub>/g, "}");

                        latex = latex.replace(/<m:d(?:>| [^>]*>)/g, "\\left(");
                        latex = latex.replace(/<\/m:d>/g, "\\right)");

                        latex = latex.replace(/<m:e(?:>| [^>]*>)/g, "{");
                        latex = latex.replace(/<\/m:e>/g, "}");
                        
                        // Clean up remaining math tags
                        latex = latex.replace(/<\/?[^>]+(>|$)/g, "").trim();
                        // Unescape basic html entities
                        latex = latex.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
                        
                        return `<w:r><w:t xml:space="preserve">\\(${latex}\\)</w:t></w:r>`;
                    });
                    
                    if (hasMod) {
                        zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
                        modifiedBuffer = zip.toBuffer();
                    }
                }
            } catch (err) {
                console.error("[OMML PARSER] Error parsing docx XML:", err);
            }

            const rawHtml = await mammoth.convertToHtml({ buffer: modifiedBuffer });
            let textValue = htmlToTextWithNumbers(rawHtml.value);
            
            // Post-process [IMG] tags to real HTML tags
            textValue = textValue.replace(/\[IMG\](.*?)\[\/IMG\]/g, '<br/><img src="$1" class="w-full max-w-sm rounded-lg border border-slate-200" /><br/>');
            
            if (questionType === 7) {
                parsedQuestions = parseMixedFormat(textValue);
            } else if (isMatching) {
                parsedQuestions = parseTextMatching(textValue);
            } else if (isEssay) {
                parsedQuestions = parseTextEssay(textValue);
                console.log("[DEBUG IMPORT ESAI] Parsed Output Length:", parsedQuestions.length);
            } else if (isBenarSalah) {
                parsedQuestions = parseTextBenarSalah(textValue);
            } else if (isCeklis) {
                parsedQuestions = parseTextCeklis(textValue);
            } else {
                console.log("\n--- [DEBUG IMPORT] RAW HTML ---");
                console.log(rawHtml.value.substring(0, 500) + "...");
                parsedQuestions = parseTextHeuristics(textValue);
                if (parsedQuestions.length === 0) {
                    parsedQuestions = parseTextRegex(textValue);
                }
            }
        } else if (fileName.endsWith(".pdf")) {
            const data = await pdfParse(buffer);
            if (questionType === 7) {
                parsedQuestions = parseMixedFormat(data.text);
            } else if (isMatching) {
                parsedQuestions = parseTextMatching(data.text);
            } else if (isEssay) {
                parsedQuestions = parseTextEssay(data.text);
            } else if (isBenarSalah) {
                parsedQuestions = parseTextBenarSalah(data.text);
            } else if (isCeklis) {
                parsedQuestions = parseTextCeklis(data.text);
            } else {
                parsedQuestions = parseTextHeuristics(data.text);
                if (parsedQuestions.length === 0) {
                    parsedQuestions = parseTextRegex(data.text);
                }
            }
        } else {
            return new Response(JSON.stringify({ success: false, error: "Format file tidak didukung. Gunakan .xlsx atau .pdf" }), { status: 400 });
        }
        } // end else if (file)
        if (parsedQuestions.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "Tidak ada soal yang berhasil diekstrak. Format tidak terbaca. Pastikan format sudah sesuai." }), { status: 400 });
        }

        // Insert to DB
        let insertCount = 0;
        for (const q of parsedQuestions) {
            const finalType = q._typeOverride || questionType;
            const qIsMatching = finalType === 4;
            const qIsEssay = finalType === 2 || finalType === 3;

            // Insert Question
            const insertedQ = await db.insert(questions).values({
                topicId,
                type: finalType,
                text: q.questionText,
                difficulty: 1,
                isActive: true
            }).returning();

            const newQuestionId = insertedQ[0].id;
            insertCount++;

            if (qIsMatching) {
                // Insert matching pairs into questionAnswers with matchRight + weight
                if (Array.isArray(q.pairs) && q.pairs.length > 0) {
                    for (const pair of q.pairs) {
                        await db.insert(questionAnswers).values({
                            questionId: newQuestionId,
                            text: pair.left as string,
                            matchRight: pair.right as string,
                            weight: parseFloat(String(pair.weight)) || 10,
                            isCorrect: false,
                        });
                    }
                } else {
                    console.warn(`[Import Menjodohkan] No pairs for question: ${q.questionText}`);
                }
            } else if (finalType === 1 || finalType === 5 || finalType === 6) {
                // Insert Options (PG, PGK/Ceklis, or Benar/Salah)
                if (q.options && typeof q.options === 'object') {
                    for (const [letter, opt] of Object.entries(q.options)) {
                        let isCorrect = false;
                        if (typeof opt === 'object' && opt !== null) {
                            isCorrect = (opt as any).isCorrect;
                        } else if (finalType === 6) {
                            // For Benar/Salah, the answerKey is the full string 'Benar' or 'Salah'
                            isCorrect = (typeof opt === 'string' && opt.toLowerCase() === String(q.answerKey).toLowerCase()) || 
                                        (typeof opt === 'object' && (opt as any).text.toLowerCase() === String(q.answerKey).toLowerCase());
                        } else {
                            // Fallback for older parser data, simple answerKey, or arrays (from parseTextRegex)
                            isCorrect = q.answerKey === letter.toUpperCase() || 
                                       (typeof q.answerKey === 'string' && q.answerKey.split(/[,;\s]+/).includes(letter.toUpperCase())) ||
                                       (Array.isArray(q.answerKey) && q.answerKey.includes(letter.toUpperCase()));
                        }

                        await db.insert(questionAnswers).values({
                            questionId: newQuestionId,
                            text: typeof opt === 'object' ? (opt as any).text : opt as string,
                            isCorrect
                        });
                    }
                } else {
                    console.warn(`[Import Soal] Warning: q.options is null or not an object for question: ${q.questionText}`);
                }
            } else {
                // Insert essay config with auto-extracted answer and keywords
                await db.insert(essayConfigs).values({
                    questionId: newQuestionId,
                    correctAnswer: q.answerKey || null,
                    keywords: q.answerKey ? extractKeywords(q.answerKey) : '[]',
                    gradingMode: ['keyword', 'manual', 'hybrid'].includes(gradingMode) ? gradingMode : 'manual',
                    maxScore: essayMaxScore,
                });
            }
        }

        const typeLabel = questionType === 7 ? 'Format Campuran (TKA)' : isMatching ? 'menjodohkan' : isEssay ? 'esai' : isCeklis ? 'ceklis' : questionType === 3 ? 'jawaban singkat' : questionType === 6 ? 'benar/salah' : 'pilihan ganda';
        return new Response(JSON.stringify({
            success: true,
            message: `Berhasil mengimpor ${insertCount} soal ${typeLabel}.`,
            count: insertCount
        }), { status: 200 });

    } catch (error: any) {
        console.error("Import Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message || "Gagal memproses file upload." }), { status: 500 });
    }
};

function htmlToTextWithNumbers(html: string): string {
    let result = html;
    let listCounter = 1;
    
    // Convert paragraphs and divs to newlines
    result = result.replace(/<\/(p|div|h[1-6])>/gi, '\n');
    result = result.replace(/<br\s*\/?>/gi, '\n');
    
    // Smart nested list replacement: If list has <= 6 items, assume it is Options (A, B, C, D, E). Else assume Questions (1, 2, 3...)
    result = result.replace(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, inner) => {
        const liMatches = inner.match(/<li[^>]*>[\s\S]*?<\/li>/gi);
        const count = liMatches ? liMatches.length : 0;
        
        let counter = 0;
        return '\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m: string, liInner: string) => {
            // Count <= 6 is almost always A, B, C. Count > 6 is questions.
            let label = (count <= 6) ? String.fromCharCode(65 + counter) + '. ' : (counter + 1) + '. ';
            counter++;
            return '\n' + label + liInner + '\n';
        }) + '\n';
    });
    
    // Add special space for td to prevent words sticking together in tables
    result = result.replace(/<\/td>/gi, ' \n ');
    result = result.replace(/<\/tr>/gi, '\n');
    
    // Remove tags but PRESERVE formatting tags like img, sup, sub, b, i, u, strong, em
    result = result.replace(/<(?!img\s|\/?img>|\/?sup>|\/?sub>|\/?b>|\/?i>|\/?u>|\/?strong>|\/?em>)[^>]+>/gi, '');
    
    // Decode basic HTML entities
    result = result.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    
    return result;
}

/**
 * Matching Excel Parser
 * Format:
 *   Col A: No (number, merged across pairs)
 *   Col B: Jenis — "SOAL" or "PASANGAN"
 *   Col C: Isi Kiri (left statement)
 *   Col D: Isi Kanan (right key / answer)
 *   Col E: Bobot (weight, default 10)
 */
function parseExcelMatching(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const result: any[] = [];
    let currentQuestion: any = null;

    for (let i = 1; i < rows.length; i++) { // skip header row
        const row = rows[i];
        if (!row || row.length < 3) continue;

        const jenis = String(row[1] || '').trim().toUpperCase();
        const isiKiri = String(row[2] || '').trim();
        const isiKanan = String(row[3] || '').trim();
        const bobot = parseFloat(String(row[4] || '')) || 10;

        if (jenis === 'SOAL') {
            if (currentQuestion && currentQuestion.pairs.length > 0) {
                result.push(currentQuestion);
            }
            currentQuestion = {
                questionText: isiKiri || `Soal Menjodohkan ${result.length + 1}`,
                pairs: []
            };
        } else if (jenis === 'PASANGAN' && currentQuestion) {
            if (isiKiri && isiKanan) {
                currentQuestion.pairs.push({ left: isiKiri, right: isiKanan, weight: bobot });
            }
        }
    }

    if (currentQuestion && currentQuestion.pairs.length > 0) {
        result.push(currentQuestion);
    }

    return result;
}

/**
 * Matching Word/PDF Text Parser
 * Format:
 *   1. Teks soal menjodohkan
 *   PASANGAN: Ibukota Indonesia = Jakarta = 10
 *   PASANGAN: 2 + 2 = 4 = 10
 *
 *   2. Soal berikutnya
 *   PASANGAN: Jepang = Tokyo = 10
 */
function parseTextMatching(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result: any[] = [];

    // --- TABLE FORMAT HEURISTIC (Word/PDF Tables) ---
    // If the words "PASANGAN" do not exist, we try to parse it as a flattened table
    const hasPasanganKeyword = lines.some(l => l.toUpperCase().startsWith("PASANGAN"));
    
    if (!hasPasanganKeyword) {
        let genericQuestion = {
            questionText: "Jodohkan pernyataan berikut dengan jawaban yang tepat!",
            pairs: [] as any[]
        };
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip common table headers
            if (line.match(/^(no\.?|soal|kunci\s*jawaban|jawaban|nomor)$/i)) continue;

            // Pattern 1: Table cell split into multiple lines because of <td>
            // Line 1: '1.'
            // Line 2: 'Pertanyaan kiri'
            // Line 3: 'Jawaban kanan'
            if (line.match(/^\d+[\.\)]?$/)) {
                if (i + 2 < lines.length) {
                    let left = lines[i + 1];
                    let right = lines[i + 2];
                    
                    // Only process if next lines aren't just other numbers
                    if (!left.match(/^\d+[\.\)]?$/) && !right.match(/^\d+[\.\)]?$/)) {
                        genericQuestion.pairs.push({ left, right, weight: 10 });
                        i += 2; 
                    }
                }
            } 
            // Pattern 2: List format separated by lines
            // Line 1: '1. Pertanyaan kiri'
            // Line 2: 'Jawaban kanan'
            else {
                 const listMatch = line.match(/^\d+[\.\)]\s*(.+)/);
                 if (listMatch && i + 1 < lines.length) {
                     const left = listMatch[1].trim();
                     const right = lines[i + 1];
                     
                     // Don't ingest if the next line is also a number (it means answer is missing)
                     if (!right.match(/^\d+[\.\)]/)) {
                         genericQuestion.pairs.push({ left, right, weight: 10 });
                         i++;
                     }
                 }
            }
        }
        
        if (genericQuestion.pairs.length > 0) {
            result.push(genericQuestion);
            return result;
        }
    }

    // --- STANDARD FORMAT PARSER ---
    let currentQuestion: any = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match "PASANGAN: left = right = weight" or "PASANGAN: left = right"
        const pairMatch = line.match(/^PASANGAN[:\s]+(.+?)\s*=\s*(.+?)(?:\s*=\s*(\d+(?:\.\d+)?))?\s*$/i);

        // Match "1. Question text" or "1) Question text"
        const questionMatch = line.match(/^(\d+)[.)]\s*(.+)/);

        if (pairMatch) {
            if (currentQuestion) {
                const left = pairMatch[1].trim();
                const right = pairMatch[2].trim();
                const weight = parseFloat(pairMatch[3] || '') || 10;
                if (left && right) {
                    currentQuestion.pairs.push({ left, right, weight });
                }
            }
        } else if (questionMatch) {
            if (currentQuestion && currentQuestion.pairs.length > 0) {
                result.push(currentQuestion);
            }
            currentQuestion = {
                questionText: questionMatch[2].trim(),
                pairs: []
            };
        } else if (currentQuestion && currentQuestion.pairs.length === 0) {
            // Accumulate multi-line question text (before any PASANGAN lines)
            currentQuestion.questionText += '<br/>' + line;
        }
    }

    if (currentQuestion && currentQuestion.pairs.length > 0) {
        result.push(currentQuestion);
    }

    return result;
}

/**
 * Essay Text Parser
 * Extracts numbered questions from plain text.
 * Supports: "1. Soal...", "2. Soal...", etc.
 * Does NOT require options or answer keys.
 */
function parseTextEssay(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result: { questionText: string, answerKey?: string }[] = [];

    let currentQuestion: { questionText: string, answerKey?: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match "1. Soal..." or "1) Soal..."
        const questionMatch = line.match(/^(\d+)[.)]\s*(.*)/);

        if (questionMatch) {
            if (currentQuestion && currentQuestion.questionText.trim()) {
                result.push(currentQuestion);
            }
            currentQuestion = { questionText: questionMatch[2] || '' };
        } else if (currentQuestion) {
            // Skip lines that look like PG options A/B/C/D
            const isOption = /^[A-Ea-e][.)]\s/.test(line);
            
            // Capture kunci jawaban lines
            // Tolerate "Kunci Jawaban:", "Jawaban:", "Kunci:", or just "Jawaban" without colon (often happens in Tables)
            const keyMatch = line.match(/^(?:kunci(?:\s+jawaban)?|jawaban)[\s:]*(.*)/i);

            if (keyMatch) {
                currentQuestion.answerKey = keyMatch[1].trim();
            } else if (!isOption) {
                if (currentQuestion.answerKey !== undefined) {
                    // Accumulate multi-line answer key (if empty, just use the line, else append with space/<br>)
                    currentQuestion.answerKey += (currentQuestion.answerKey ? ' ' : '') + line.trim();
                } else {
                    // Accumulate multi-line question text
                    currentQuestion.questionText += (currentQuestion.questionText ? '<br/>' : '') + line;
                }
            }
        }
    }

    if (currentQuestion && currentQuestion.questionText.trim()) {
        result.push(currentQuestion);
    }

    return result;
}

/**
 * Essay Excel Parser
 * Simpler format: Col 0 = No, Col 1 = Teks Soal
 * OR same SOAL/JAWABAN format (but ignores JAWABAN rows)
 */
function parseExcelEssay(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const result: { questionText: string, answerKey?: string }[] = [];
    let currentQuestion: { questionText: string, answerKey?: string } | null = null;

    for (let i = 1; i < rows.length; i++) { // skip header row
        const row = rows[i];
        if (!row || row.length < 2) continue;

        // Try to detect format: if col1 is "SOAL", use col2
        const col1 = String(row[1] || '').trim().toUpperCase();
        if (col1 === 'SOAL') {
            const text = String(row[2] || '').trim();
            if (text) {
                if (currentQuestion) result.push(currentQuestion);
                currentQuestion = { questionText: text };
            }
        } else if (col1 === 'JAWABAN') {
            const text = String(row[2] || '').trim();
            if (text && currentQuestion) {
                currentQuestion.answerKey = text;
            }
        } else if (col1 !== 'NO' && col1 !== 'JENIS') {
            // Simple 2-column format: col0=No, col1=Text, col2=Key
            const text = String(row[1] || '').trim();
            const key = String(row[2] || '').trim();
            if (text && text.length > 5) {
                if (currentQuestion) result.push(currentQuestion);
                currentQuestion = { questionText: text };
                if (key) currentQuestion.answerKey = key;
            }
        }
    }

    if (currentQuestion) {
        result.push(currentQuestion);
    }

    return result;
}



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

            currentQuestion.options[letter] = { text: isi, isCorrect };
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
            currentQuestion.options[letter] = { text: optText, isCorrect };
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
    let isExpectingNewQuestion = true;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // More robust parsing Regex that tolerates HTML tags
        const questionMatch = line.match(/^(?:<[^>]+>)*(\d+)(?:<[^>]+>)*\.\s*(.*)/);
        const optionMatch = line.match(/^(?:<[^>]+>)*([A-Ea-e]|[أابجدهوزحطي](?:ـ)?)(?:<[^>]+>)*[\.\)]\s*(.*)/);
        const keyMatch = line.match(/^(?:<[^>]+>)*Kunci(?: Jawaban)?:\s*([A-Ea-eأ-ي\s,;ـ]+)/i);

        if (questionMatch) {
            // Save previous question
            if (currentQuestion) {
                if (currentOptionLetter) currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
                result.push(currentQuestion);
            }

            currentQuestion = {
                questionText: questionMatch[2],
                options: {},
                answerKey: [] // Change to array for multi-keys
            };
            currentOptionLetter = "";
            currentOptionText = "";
            isExpectingNewQuestion = false;
            continue;
        }

        if (optionMatch) {
            // If option comes before any question is detected, create a dummy question
            if (!currentQuestion) {
                currentQuestion = { questionText: "", options: {}, answerKey: null };
            }
            // Save previous option
            if (currentOptionLetter) {
                currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
            }

            let rawLetter = optionMatch[1].toUpperCase();
            const arabicMap: Record<string, string> = {
                'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D', 'ه': 'E', 'هـ': 'E', 'ة': 'E'
            };
            currentOptionLetter = arabicMap[rawLetter] || rawLetter;
            currentOptionText = optionMatch[2];
            isExpectingNewQuestion = false; // definitely not expecting a new question until we see a Key
            continue;
        }

        if (keyMatch && currentQuestion) {
            if (currentOptionLetter) {
                currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
            }
            // Support "Kunci: A,C,D" or Arabic keys
            const mapArabic = (k: string) => {
                const arabicMap: Record<string, string> = { 'أ':'A', 'ا':'A', 'ب':'B', 'ج':'C', 'د':'D', 'ه':'E', 'هـ':'E', 'ة':'E' };
                return arabicMap[k] || k;
            };
            const keys = keyMatch[1].toUpperCase().split(/[,;\s]+/).filter(Boolean).map(mapArabic);
            currentQuestion.answerKey = keys;
            currentOptionLetter = "";
            currentOptionText = "";
            
            // After the key, the very next regular text line MUST be a new question
            isExpectingNewQuestion = true;
            continue;
        }

        // Regular multi-line text (no special markers matched)
        if (isExpectingNewQuestion) {
            // This line is the start of a completely new question (e.g., number was missing)
            if (currentQuestion) {
                if (currentOptionLetter) currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
                result.push(currentQuestion);
            }
            currentQuestion = { questionText: line, options: {}, answerKey: null };
            currentOptionLetter = "";
            currentOptionText = "";
            isExpectingNewQuestion = false;
        } else if (currentQuestion) {
            // Accumulate text into the current active bucket (question or option)
            if (currentOptionLetter) {
                currentOptionText += (currentOptionText ? "<br/>" : "") + line;
            } else {
                currentQuestion.questionText += (currentQuestion.questionText ? "<br/>" : "") + line;
            }
        }
    }

    if (currentQuestion) {
        if (currentOptionLetter) {
            currentQuestion.options[currentOptionLetter] = currentOptionText.trim();
        }
        result.push(currentQuestion);
    }

    return result;
}

// ─── PARSER: BENAR/SALAH (TYPE 6) - TEXT (DOCX/PDF) ───
// Format Word:
// 1. Pernyataan soal.
//    A. Benar  B. Salah  Kunci Jawaban: Benar
function parseTextBenarSalah(text: string): any[] {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const result: any[] = [];
    let current: any = null;

    const soalRegex = /^(?:<[^>]+>)*(\d+)(?:<[^>]+>)*\.\s*(.*)/;
    const kunciRegex = /(?:<[^>]+>)*(?:kunci\s*jawaban|kunci)\s*:?\s*(benar|salah|true|false|b|s)/i;

    for (const line of lines) {
        const soalMatch = line.match(soalRegex);
        if (soalMatch) {
            if (current) result.push(current);
            const textContent = soalMatch[2] ? soalMatch[2].trim() : "";
            current = { questionText: textContent, answerKey: null };
            // Inline kunci on same line
            const inlineKunci = line.match(kunciRegex);
            if (inlineKunci) {
                const raw = inlineKunci[1].toLowerCase();
                current.answerKey = (raw === 'benar' || raw === 'true' || raw === 'b') ? 'Benar' : 'Salah';
            }
            continue;
        }

        const blockKunci = line.match(kunciRegex);
        if (blockKunci && current) {
            const raw = blockKunci[1].toLowerCase();
            current.answerKey = (raw === 'benar' || raw === 'true' || raw === 'b') ? 'Benar' : 'Salah';
            continue;
        }

        if (current) {
            // Ignore if line is literally just "A. Benar" or "B. Salah" as options since we render custom buttons
            // Tolerates HTML tags
            const textOnly = line.replace(/<[^>]+>/g, "").trim();
            if (!textOnly.match(/^[a-b][\.\)]\s*(benar|salah)$/i)) {
                current.questionText += (current.questionText ? " <br/>" : "") + line;
            }
        }
    }
    if (current) result.push(current);

    return result
        .filter(q => q.questionText && q.answerKey)
        .map(q => ({
            questionText: q.questionText.trim(),
            options: { A: 'Benar', B: 'Salah' },
            answerKey: q.answerKey, // 'Benar' or 'Salah'
        }));
}

// ─── PARSER: BENAR/SALAH (TYPE 6) - EXCEL ───
// Format Excel: Col A: No | Col B: Pernyataan | Col C: Jawaban (Benar/Salah)
function parseExcelBenarSalah(buffer: Buffer): any[] {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const result: any[] = [];

    for (const row of rows) {
        if (!row[0] || isNaN(parseInt(String(row[0])))) continue;
        const questionText = String(row[1] || '').trim();
        const jawaban = String(row[2] || '').trim().toLowerCase();
        if (!questionText) continue;
        const answerKey = (jawaban === 'benar' || jawaban === 'true' || jawaban === 'b' || jawaban === '1') ? 'Benar' : 'Salah';
        result.push({ questionText, options: { A: 'Benar', B: 'Salah' }, answerKey });
    }
    return result;
}


// ─── PARSER: CEKLIS / PGK (TYPE 5) - TEXT (DOCX/PDF) ───
// Format Word:
// 1. Soal ceklis.
//    1. Opsi A
//    2. Opsi B
//    3. Opsi C
//    Kunci Jawaban: 1,3
function parseTextCeklis(text: string): any[] {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const result: any[] = [];
    let current: any = null;
    let collectingOptions = false;
    let lastOptionNum = 0;

    const soalRegex = /^(?:<[^>]+>)*(\d+)(?:<[^>]+>)*\.\s*(.*)/;
    const opsiRegex = /^(?:<[^>]+>)*(\d+)(?:<[^>]+>)*\.\s*(.*)/;
    const kunciRegex = /(?:<[^>]+>)*(?:kunci\s*jawaban|kunci)\s*:?\s*([\d,\s]+)/i;

    for (const line of lines) {
        const kunci = line.match(kunciRegex);
        if (kunci && current) {
            const keys = kunci[1].split(',').map(s => s.trim()).filter(Boolean);
            current.answerKeys = keys;
            collectingOptions = false;
            continue;
        }

        // Option line inside a question (single-digit number followed by text)
        if (current && collectingOptions) {
            const opsiMatch = line.match(opsiRegex);
            if (opsiMatch) {
                const num = parseInt(opsiMatch[1]);
                if (num === lastOptionNum + 1 || (num === 1 && lastOptionNum === 0)) {
                    current.options[opsiMatch[1]] = opsiMatch[2] ? opsiMatch[2].trim() : "";
                    lastOptionNum = num;
                    continue;
                }
            }
        }

        const soalMatch = line.match(soalRegex);
        if (soalMatch) {
            // Could be main question number
            const num = parseInt(soalMatch[1]);
            const text = soalMatch[2] ? soalMatch[2].trim() : "";
            if (!current || num !== lastOptionNum + 1) {
                if (current) result.push(current);
                current = { questionText: text, options: {}, answerKeys: [] };
                collectingOptions = true;
                lastOptionNum = 0;
                continue;
            }
        }

        if (current) {
            current.questionText += (current.questionText ? " " : "") + line;
        }
    }
    if (current) result.push(current);

    return result
        .filter(q => q.questionText && Object.keys(q.options).length > 0)
        .map(q => ({
            questionText: q.questionText.trim(),
            options: q.options,
            answerKey: q.answerKeys.join(','), // "1,3,4"
        }));
}

// ─── PARSER: CAMPURAN (MIXED / TKA FORMAT) ───
// Splits the single document by headers like "Format soal pilihan ganda"
function parseMixedFormat(text: string): any[] {
    const patterns = [
        { type: 1, regex: /format\s+soal\s+pilihan\s+ganda/i },
        { type: 2, regex: /format\s+soal\s+esai/i },
        { type: 3, regex: /format\s+soal\s+jawaban\s+singkat/i },
        { type: 4, regex: /format\s+soal\s+menjodohkan/i },
        { type: 5, regex: /format\s+soal\s+ceklis/i },
        { type: 6, regex: /format\s+soal\s+benar\s+salah/i },
    ];

    const lines = text.split('\n');
    let currentChunkType = 0;
    let chunks: { type: number, text: string }[] = [];
    let currentChunkLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let matchedType = 0;
        
        for (const p of patterns) {
            if (p.regex.test(line)) {
                matchedType = p.type;
                break;
            }
        }

        if (matchedType !== 0) {
            // Push previous chunk
            if (currentChunkType !== 0 && currentChunkLines.length > 0) {
                chunks.push({ type: currentChunkType, text: currentChunkLines.join('\n') });
            }
            currentChunkType = matchedType;
            currentChunkLines = [];
        } else {
            // Add to current chunk
            if (currentChunkType !== 0) {
                currentChunkLines.push(lines[i]);
            }
        }
    }

    // Push the last chunk
    if (currentChunkType !== 0 && currentChunkLines.length > 0) {
        chunks.push({ type: currentChunkType, text: currentChunkLines.join('\n') });
    }

    const allQuestions: any[] = [];
    
    // Process each chunk with appropriate existing parsers
    for (const chunk of chunks) {
        let qs: any[] = [];
        if (chunk.type === 1) {
            qs = parseTextHeuristics(chunk.text);
            if (qs.length === 0) qs = parseTextRegex(chunk.text);
        } else if (chunk.type === 2 || chunk.type === 3) {
            qs = parseTextEssay(chunk.text);
        } else if (chunk.type === 4) {
             qs = parseTextMatching(chunk.text);
        } else if (chunk.type === 5) {
             qs = parseTextCeklis(chunk.text);
        } else if (chunk.type === 6) {
             qs = parseTextBenarSalah(chunk.text);
        }
        
        // Attach the specific type to each parsed question
        for (const q of qs) {
             q._typeOverride = chunk.type;
             allQuestions.push(q);
        }
    }

    return allQuestions;
}
