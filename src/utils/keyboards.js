import { getCategoriesFromSheet, getCategoryNames } from '../services/sheets.js';

export function getMainMenuKeyboard(pName, hasPairs = true) {
    if (!hasPairs) {
        return { keyboard: [[{ text: "🔗 Пригласить партнера" }], [{ text: "⚙️ Настройки" }]], resize_keyboard: true, persistent: true };
    }
    const row1 = [{ text: "🎯 Задать вопрос" }, { text: "📚 Выбрать тему" }];
    const row2 = pName ? [{ text: "🔥 Наш прогресс" }, { text: "⚙️ Настройки" }] : [{ text: "⚙️ Настройки" }];
    return { keyboard: [row1, row2], resize_keyboard: true, persistent: true };
}

export async function showCatalog(page) {
    const catsData = await getCategoriesFromSheet();
    const catNames = getCategoryNames(catsData);

    const items = ['GLOBAL_RANDOM', ...catNames];
    const ITEMS_PER_PAGE = 4;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);

    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let kb = [];
    for (let item of pageItems) {
        if (item === 'GLOBAL_RANDOM') {
            kb.push([{ text: "🎲 Любой вопрос", callback_data: `selectcat_GLOBAL_RANDOM` }]);
        } else {
            const catIndex = catNames.indexOf(item);
            kb.push([{ text: `📂 ${item}`, callback_data: `selectcat_${catIndex}` }]);
        }
    }

    if (totalPages > 1) {
        let navRow = [];
        if (page > 1) navRow.push({ text: "⬅️ Назад", callback_data: `catpage_${page - 1}` });
        navRow.push({ text: `Стр. ${page}/${totalPages}`, callback_data: `catpage_ignore` });
        if (page < totalPages) navRow.push({ text: "Вперед ➡️", callback_data: `catpage_${page + 1}` });
        kb.push(navRow);
    }

    kb.push([{ text: "🗂 Главное меню", callback_data: "catpage_close" }]);

    return { inline_keyboard: kb };
}

export function makeInlineKeyboard(pairs, prefix) {
    const kb = [];
    for (const [pId, pName] of Object.entries(pairs)) {
        kb.push([{ text: pName, callback_data: `${prefix}_${pId}` }]);
    }
    return { inline_keyboard: kb };
}

export function getCancelMenu() {
    return { keyboard: [[{ text: "❌ Отмена" }]], resize_keyboard: true };
}

export function getLaterMenu() {
    return { keyboard: [[{ text: "⏳ Ответить позже" }]], resize_keyboard: true };
}

export function getNudgeMenu(pId) {
    return { inline_keyboard: [[{ text: `🔔 Напомнить партнеру`, callback_data: `nudge_${pId}` }]] };
}

export function getAnswerButton(pId, label = '📝 Ответить') {
    return { inline_keyboard: [[{ text: label, callback_data: `ans_${pId}` }]] };
}

export function getAdminMenu(isMaintenance) {
    return {
        keyboard: [
            [{ text: "🚀 Создать рассылку" }, { text: "📈 Статистика бота" }],
            [{ text: "🔍 Найти юзера" }, { text: "Получить ID" }],
            [{ text: isMaintenance === 'ON' ? "🛠 Тех. работы: ВКЛ" : "🛠 Тех. работы: ВЫКЛ" }, { text: "❌ Выйти в меню" }]
        ],
        resize_keyboard: true,
        persistent: true
    };
}

export function getSettingsMenu() {
    return {
        keyboard: [
            [{ text: "🔗 Пригласить партнера" }, { text: "👫 Настройки пары" }],
            [{ text: "🔄 Сбросить вопрос" }, { text: "🔁 Повторить вопрос" }],
            [{ text: "🆘 Поддержка" }, { text: "🗂 Главное меню" }]
        ],
        resize_keyboard: true,
        persistent: true
    };
}

export function getPairSettingsMenu() {
    return {
        keyboard: [
            [{ text: "✏️ Изменить имя" }, { text: "📊 Статистика" }],
            [{ text: "✂️ Удалить пару" }, { text: "🔙 Назад в настройки" }]
        ],
        resize_keyboard: true,
        persistent: true
    };
}

export function getRenameMenu(partnerName) {
    return {
        keyboard: [[{ text: `Оставить "${partnerName}"` }]],
        resize_keyboard: true
    };
}

export function getDeleteConfirmMenu() {
    return { keyboard: [[{ text: "✅ Да, удалить" }, { text: "❌ Отмена" }]], resize_keyboard: true };
}

export function getBroadcastPreviewMenu() {
    return { inline_keyboard: [[{ text: "✅ Запустить", callback_data: "bc_start" }, { text: "❌ Отмена", callback_data: "bc_cancel" }]] };
}

export function getBanMenu(targetId, isBanned) {
    return {
        inline_keyboard: [[{
            text: isBanned ? "✅ Разбанить" : "🚫 Забанить",
            callback_data: isBanned ? `unban_${targetId}` : `ban_${targetId}`
        }]]
    };
}
