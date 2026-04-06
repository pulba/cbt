/**
 * Essay Scoring Utility
 * Supports keyword matching, exact match, and text similarity scoring
 */

export interface Keyword {
    word: string;
    score: number;
    synonyms?: string[]; // optional word variants
}

/**
 * Normalize text: lowercase, remove punctuation, trim
 */
export function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ") // remove punctuation
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Score by keyword matching with synonyms support
 * Returns 0-totalKeywordScore
 */
export function scoreByKeywords(
    answer: string,
    keywords: Keyword[]
): { score: number; maxScore: number; matched: string[]; missed: string[] } {
    const normalized = normalizeText(answer);
    let score = 0;
    const matched: string[] = [];
    const missed: string[] = [];
    const maxScore = keywords.reduce((s, k) => s + k.score, 0);

    for (const kw of keywords) {
        const allWords = [kw.word.toLowerCase(), ...(kw.synonyms ?? []).map(s => s.toLowerCase())];
        const found = allWords.some(w => normalized.includes(normalizeText(w)));
        if (found) {
            score += kw.score;
            matched.push(kw.word);
        } else {
            missed.push(kw.word);
        }
    }

    return { score, maxScore, matched, missed };
}

/**
 * Score by exact match (case-insensitive)
 * Returns 0 or 100
 */
export function scoreByExactMatch(answer: string, correct: string): number {
    return normalizeText(answer) === normalizeText(correct) ? 100 : 0;
}

/**
 * Simple character-level similarity score (0-100)
 * Based on longest common subsequence ratio
 */
export function scoreBySimiliarity(a: string, b: string): number {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 100;

    const longer = na.length > nb.length ? na : nb;
    const shorter = na.length > nb.length ? nb : na;

    // Compute Levenshtein distance
    const dp: number[][] = Array.from({ length: shorter.length + 1 }, (_, i) =>
        Array.from({ length: longer.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= shorter.length; i++) {
        for (let j = 1; j <= longer.length; j++) {
            if (shorter[i - 1] === longer[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }

    const distance = dp[shorter.length][longer.length];
    const similarity = 1 - distance / longer.length;
    return Math.round(Math.max(0, similarity) * 100);
}

/**
 * Main grading function — picks the right strategy based on gradingMode
 * Returns a score 0..maxScore
 */
export function autoGradeEssay(params: {
    answer: string;
    correctAnswer?: string;
    keywords?: Keyword[];
    gradingMode: "keyword" | "manual" | "hybrid" | string;
    maxScore: number;
}): { score: number; notes: string } {
    const { answer, correctAnswer, keywords, maxScore } = params;
    // Normalize gradingMode — trim whitespace, lowercase
    const gradingMode = (params.gradingMode ?? "manual").toString().trim().toLowerCase();

    if (!answer || answer.trim() === "") {
        return { score: 0, notes: "Tidak ada jawaban." };
    }

    if (gradingMode === "manual") {
        // No auto-scoring; return 0 pending teacher review
        return { score: 0, notes: "Menunggu koreksi guru." };
    }

    if (gradingMode === "keyword") {
        const hasKeywords = keywords && keywords.length > 0;

        if (hasKeywords) {
            // Full keyword matching
            const { score: kwScore, maxScore: kwMax, matched, missed } = scoreByKeywords(answer, keywords!);
            const normalizedScore = kwMax > 0 ? (kwScore / kwMax) * maxScore : 0;
            const score = Math.round(normalizedScore * 10) / 10;
            const notes = [
                `Auto-graded (keyword). Kata kunci ditemukan: ${matched.join(", ") || "tidak ada"}.`,
                missed.length > 0 ? `Tidak ditemukan: ${missed.join(", ")}.` : "",
            ]
                .filter(Boolean)
                .join(" ");
            return { score, notes };
        } else if (correctAnswer) {
            // Fallback: no keywords defined → similarity vs correct answer
            const simScore = scoreBySimiliarity(answer, correctAnswer);
            const score = Math.round((simScore / 100) * maxScore * 10) / 10;
            return {
                score,
                notes: `Auto-graded (keyword→similarity fallback, kata kunci belum dikonfigurasi). Kemiripan: ${simScore}%.`,
            };
        } else {
            // No keywords AND no correct answer → manual review
            return {
                score: 0,
                notes: "Kata kunci belum dikonfigurasi. Menunggu koreksi guru.",
            };
        }
    }

    if (gradingMode === "hybrid") {
        // Hybrid: keyword scoring + partial similarity to correct answer
        let kwResult = { score: 0, maxScore: 100, matched: [] as string[], missed: [] as string[] };
        if (keywords && keywords.length > 0) {
            kwResult = scoreByKeywords(answer, keywords);
        }

        let simScore = 0;
        if (correctAnswer) {
            simScore = scoreBySimiliarity(answer, correctAnswer);
        }

        // Weight: 70% keywords, 30% similarity
        const rawKw = kwResult.maxScore > 0 ? (kwResult.score / kwResult.maxScore) * 70 : 0;
        const rawSim = simScore * 0.3;
        const combined = (rawKw + rawSim) / 100;
        const score = Math.round(combined * maxScore * 10) / 10;

        const notes = `Auto-graded (hybrid). Kata kunci: ${kwResult.matched.join(", ") || "tidak ada"}. Kemiripan: ${simScore}%.`;
        return { score, notes };
    }

    // Unknown mode fallback — treat as manual
    return { score: 0, notes: `Mode penilaian '${gradingMode}' tidak dikenal. Menunggu koreksi guru.` };
}

