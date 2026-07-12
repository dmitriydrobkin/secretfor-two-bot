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

export function pickRandomQuestion(catsData, catIdentifier) {
    if (catIdentifier === 'GLOBAL_RANDOM') {
        let allQs = [];
        for (let cat in catsData) {
            allQs.push(...catsData[cat]);
        }
        if (allQs.length > 0) return allQs[Math.floor(Math.random() * allQs.length)];
        return "Вопросов не найдено.";
    }

    const catNames = getCategoryNames(catsData);
    const catIndex = parseInt(catIdentifier);
    const actualCatName = catNames[catIndex];
    if (actualCatName) {
        const catQs = catsData[actualCatName];
        if (catQs && catQs.length > 0) return catQs[Math.floor(Math.random() * catQs.length)];
    }
    return "Вопросов не найдено.";
}
