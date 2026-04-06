const text = `
1. Nilai $x$ yang memenuhi persamaan $|x + 5| = 3$ adalah
A. $x = 1$ dan $x = 2$
B. $x = -2$ dan $x = -8$
C. $x = -1$ dan $x = 2$
D. $x = 3$ dan $x = -8$
E. $x = 2$ dan $x = 7$
Kunci Jawaban: B
2. Penyelesaian dari $\\sqrt{2x + 6} > 0$ adalah
A. $x < 3$
B. $x \\le -3$
C. $x \\ge -3$
D. $x > -3$
E. $x < 6$
Kunci Jawaban: D
`;

function parseTextRegex(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result = [];

    let currentQuestion = null;
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

console.log(JSON.stringify(parseTextRegex(text), null, 2));
