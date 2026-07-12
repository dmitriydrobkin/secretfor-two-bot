const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlSFyq_lUf2esDxCHp3byPN9Sqe88NWM-gWi8B-3SCjj9z8yDucaYZcxkChUd2MT1_r5LeUAr-U2Je/pub?output=csv";

export async function getCategoriesFromSheet() {
    const response = await fetch(SHEET_URL);
    const csvText = await response.text();
    const lines = csvText.split('\n').map(q => q.trim()).filter(q => q.length > 0);

    let categories = {};
    let currentCat = "Без категории";

    for (let line of lines) {
        const catMatch = line.match(/^---\s*(.*?)\s*---$/);
        if (catMatch) {
            currentCat = catMatch[1].trim().replace(/[\r\n]+/g, '');
            if (currentCat.length > 30) currentCat = currentCat.substring(0, 30);
        } else {
            if (line.startsWith('"') && line.endsWith('"')) line = line.slice(1, -1);
            if (line && line.trim() !== '' && !line.includes('---') && line !== currentCat) {
                if (!categories[currentCat]) categories[currentCat] = [];
                categories[currentCat].push(line);
            }
        }
    }
    return categories;
}

export function getCategoryNames(catsData) {
    return Object.keys(catsData).filter(c => c !== "Без категории" && catsData[c].length > 0);
}

export function pickRandomQuestion(catsData, catIdentifier, usedQuestions = []) {
    let pool = [];
    if (catIdentifier === 'GLOBAL_RANDOM') {
        for (let cat in catsData) {
            pool.push(...catsData[cat]);
        }
    } else {
        const catNames = getCategoryNames(catsData);
        const actualCatName = catNames[parseInt(catIdentifier)];
        if (actualCatName) {
            pool = catsData[actualCatName] || [];
        }
    }

    if (pool.length === 0) return { question: "Вопросов не найдено.", resetHappened: false };

    let availableQs = pool.filter(q => !usedQuestions.includes(q));
    
    let resetHappened = false;
    if (availableQs.length === 0) {
        availableQs = pool;
        resetHappened = true;
    }

    const picked = availableQs[Math.floor(Math.random() * availableQs.length)];
    return { question: picked, resetHappened };
}
