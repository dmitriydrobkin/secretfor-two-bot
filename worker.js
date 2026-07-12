function updateStreak(pair) {
    const KyivDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
    const todayStr = KyivDate.toISOString().split('T')[0];

    if (!pair.current_streak) pair.current_streak = 0;

    if (!pair.last_reply_date) {
        pair.current_streak = 1;
    } else {
        const lastDate = new Date(pair.last_reply_date);
        const currDate = new Date(todayStr);
        const diffTime = Math.abs(currDate - lastDate);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            pair.current_streak++;
        } else if (diffDays === 0) {
            // стрик не меняется (ответили на второй вопрос за сутки)
        } else {
            pair.current_streak = 1;
        }
    }
    pair.last_reply_date = todayStr;
    return pair;
}


async function getCategoriesFromSheet() {
    const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlSFyq_lUf2esDxCHp3byPN9Sqe88NWM-gWi8B-3SCjj9z8yDucaYZcxkChUd2MT1_r5LeUAr-U2Je/pub?output=csv";
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

async function showCatalog(page, pId) {
    const catsData = await getCategoriesFromSheet();
    const catNames = Object.keys(catsData).filter(c => c !== "Без категории" && catsData[c].length > 0);

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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function doDailyNudge(env) {
    const KyivDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
    const todayStr = KyivDate.toISOString().split('T')[0];

    const pairsList = await env.DB.list({ prefix: 'pair_' });
    for (const key of pairsList.keys) {
        const pId = key.name;
        const pair = await env.DB.get(pId, 'json');

        if (pair && pair.users && pair.users.length === 2) {
            if (pair.last_reply_date !== todayStr) {
                let msgText = "🎯 **Ежедневный вызов готов!**\n\nВы еще не общались сегодня. Зайдите в 📚 Выбрать тему, выберите категорию и ответьте на вопрос, чтобы не потерять ваш горящий стрик дней 🔥!";
                if (pair.current_streak > 0) {
                    msgText += `\n\nВаш стрик: ${pair.current_streak} дней под угрозой! 🛠`;
                }

                for (const userId of pair.users) {
                    await sendMessage(env.BOT_TOKEN, userId, msgText);
                    await delay(100);
                }
            }
        }
    }
}

function getMainMenuKeyboard(pName, hasPairs = true) {
    if (!hasPairs) {
        return { keyboard: [[{ text: "🔗 Пригласить партнера" }], [{ text: "⚙️ Настройки" }]], resize_keyboard: true, persistent: true };
    }
    const row1 = [{ text: "🎯 Задать вопрос" }, { text: "📚 Выбрать тему" }];
    const row2 = pName ? [{ text: "🔥 Наш прогресс" }, { text: "⚙️ Настройки" }] : [{ text: "⚙️ Настройки" }];
    return { keyboard: [row1, row2], resize_keyboard: true, persistent: true };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') return new Response('Бот работает!', { status: 200 });

        const payload = await request.json();

        // --- АДМИНСКИЕ ПЕРЕМЕННЫЕ ---
        const ADMIN_ID = 759276032;

        // ==========================================
        // БЛОК 1: ОБРАБОТКА НАЖАТИЙ НА INLINE-КНОПКИ
        // ==========================================
        if (payload.callback_query) {
            const cq = payload.callback_query;
            const data = cq.data;
            const chatId = cq.message.chat.id;
            const userId = cq.from.id;

            let user = await env.DB.get(`user_${userId}`, 'json');
            if (!user) return new Response('OK');

            const pairKeys = Object.keys(user.pairs || {});
            const partnerName = pairKeys.length === 1 ? user.pairs[pairKeys[0]] : null;

            const cancelMenu = { keyboard: [[{ text: "❌ Отмена" }]], resize_keyboard: true };
            const laterMenu = { keyboard: [[{ text: "⏳ Ответить позже" }]], resize_keyboard: true };

            // Если выбрали кому задать вопрос (для мульти-пар)
            if (data.startsWith('ask_')) {
                const pId = data.replace('ask_', '');
                const pair = await env.DB.get(pId, 'json');

                // ПРОВЕРКА НА СПАМ ВОПРОСАМИ
                if (pair && pair.question) {
                    if (pair.answers && pair.answers[userId]) {
                        const nudgeMenu = { inline_keyboard: [[{ text: `🔔 Напомнить партнеру`, callback_data: `nudge_${pId}` }]] };
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ У вас уже есть активный вопрос, и ты на него ответил! Пнуть партнера?", nudgeMenu);
                    } else {
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Уже есть активный вопрос! Сначала тебе нужно на него ответить.");
                    }
                } else {
                    user.state = `WAITING_QUESTION_${pId}`;
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));
                    await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/qM82VKr0/Frame-54.png", `📝 Напиши свой вопрос для **${user.pairs[pId]}** 👇\n\nМожно задать:\n— Текстом\n— Картинкой`, cancelMenu);
                }
            }
            // Если нажали "Ответить" на пришедший вопрос
            else if (data.startsWith('ans_')) {
                const pId = data.replace('ans_', '');
                const pair = await env.DB.get(pId, 'json');

                if (!pair || !pair.question) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Этот вопрос уже не актуален.");
                } else if (pair.answers && pair.answers[userId]) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Ты уже ответил на этот вопрос! Ждем партнера.");
                } else {
                    user.state = `WAITING_ANSWER_${pId}`;
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));
                    const authorName = (pair.question.senderId == userId) ? "тебя" : user.pairs[pId];
                    await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/HDVzncF7/Frame-60.png", `Введи свой ответ на вопрос от **${authorName}** 👇\n\n_${pair.question.text || '📸 Фото-вопрос'}_\n\n⚠️ *Можно ответить текстом, кружочком (до 59 сек) или голосовым (до 5 мин). Отправь строго ОДНО сообщение!*`, laterMenu);
                }
            }
            // Статистика конкретной пары
            else if (data.startsWith('stat_')) {
                const pId = data.replace('stat_', '');
                const pair = await env.DB.get(pId, 'json');
                await sendMessage(env.BOT_TOKEN, chatId, `📊 В паре с **${user.pairs[pId]}** вы ответили на **${pair.count}** вопросов!`);
            }

            // Кнопка "Напомнить партнеру" (Пнуть)
            else if (data.startsWith('nudge_')) {
                const pId = data.replace('nudge_', '');
                const pair = await env.DB.get(pId, 'json');

                if (!pair || !pair.question) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Активный вопрос уже завершен или сброшен.");
                } else if (pair.answers && Object.keys(pair.answers).length === 2) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Партнер уже ответил!");
                } else {
                    const partnerId = pair.users.find(id => id != userId);
                    if (partnerId) {
                        let partnerProfile = await env.DB.get(`user_${partnerId}`, 'json');
                        let myNameForPartner = partnerProfile.pairs[pId] || user.name;

                        const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить`, callback_data: `ans_${pId}` }]] };
                        await sendPhoto(env.BOT_TOKEN, partnerId, "https://i.ibb.co/Lz8TVJFj/Frame-62.png", `🔔 **${myNameForPartner}** ждет твой ответ!\n\nАууу, пора ответить на активный вопрос! 👇`, ansBtn);
                        await sendMessage(env.BOT_TOKEN, chatId, "✅ Напоминание успешно отправлено!");
                    }
                }
            }

            // --- АДМИНСКИЕ INLINE КНОПКИ ---
            else if (data === 'bc_start') {
                const temp = await env.DB.get('temp_broadcast', 'json');
                if (!temp) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Данные потеряны. Начни создание рассылки заново.");
                } else {
                    await sendMessage(env.BOT_TOKEN, chatId, "🚀 **Рассылка запущена!**\nСкрипт пошел по базе. Ты получишь отчет, когда всё закончится.");
                    ctx.waitUntil(doBroadcast(env, temp.photoId, temp.caption, ADMIN_ID));
                    await env.DB.delete('temp_broadcast');
                }
            }
            else if (data === 'bc_cancel') {
                await env.DB.delete('temp_broadcast');
                await sendMessage(env.BOT_TOKEN, chatId, "❌ Рассылка отменена.");
            }
            else if (data.startsWith('ban_')) {
                const targetId = data.replace('ban_', '');
                let targetUser = await env.DB.get(`user_${targetId}`, 'json');
                if (targetUser) {
                    targetUser.state = 'BANNED';
                    await env.DB.put(`user_${targetId}`, JSON.stringify(targetUser));
                    await sendMessage(env.BOT_TOKEN, chatId, `🚫 Пользователь ${targetId} ЗАБАНЕН.`, { inline_keyboard: [[{ text: "✅ Разбанить", callback_data: `unban_${targetId}` }]] });
                }
            }
            else if (data.startsWith('unban_')) {
                const targetId = data.replace('unban_', '');
                let targetUser = await env.DB.get(`user_${targetId}`, 'json');
                if (targetUser) {
                    targetUser.state = 'IDLE';
                    await env.DB.put(`user_${targetId}`, JSON.stringify(targetUser));
                    await sendMessage(env.BOT_TOKEN, chatId, `✅ Пользователь ${targetId} РАЗБАНЕН.`, { inline_keyboard: [[{ text: "🚫 Забанить", callback_data: `ban_${targetId}` }]] });
                }
            }


            // --- КАТАЛОГ: ПАГИНАЦИЯ И ВЫБОР ---
            else if (data.startsWith('cat_')) {
                const pId = data.replace('cat_', '');
                user.state = `BROWSING_CATEGORIES_${pId}`;
                await env.DB.put(`user_${userId}`, JSON.stringify(user));

                const kb = await showCatalog(1, pId);
                await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/F4J88zZ9/Frame-53.png", "🗂 **Каталог тем**\n\nВыберите категорию для вопроса:", kb);
            }
            else if (data.startsWith('catpage_')) {
                const action = data.replace('catpage_', '');
                if (action === 'close') {
                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));
                    await deleteMessage(env.BOT_TOKEN, chatId, cq.message.message_id);
                } else if (action !== 'ignore') {
                    if (!user.state.startsWith('BROWSING_CATEGORIES_')) {
                        await answerCallbackQuery(env.BOT_TOKEN, cq.id, { text: "Каталог устарел. Откройте его заново." });
                        return new Response('OK');
                    }
                    const page = parseInt(action);
                    const pId = user.state.replace('BROWSING_CATEGORIES_', '');
                    const kb = await showCatalog(page, pId);
                    await editMessageReplyMarkup(env.BOT_TOKEN, chatId, cq.message.message_id, kb);
                }
            }
            else if (data.startsWith('selectcat_')) {
                if (!user.state.startsWith('BROWSING_CATEGORIES_')) {
                    await answerCallbackQuery(env.BOT_TOKEN, cq.id, { text: "Каталог устарел. Откройте его заново." });
                    return new Response('OK');
                }
                const catIdentifier = data.replace('selectcat_', '');
                const pId = user.state.replace('BROWSING_CATEGORIES_', '');
                let pair = await env.DB.get(pId, 'json');

                if (pair) {
                    const catsData = await getCategoriesFromSheet();
                    let randomQ = "Вопросов не найдено.";

                    if (catIdentifier === 'GLOBAL_RANDOM') {
                        let allQs = [];
                        for (let cat in catsData) {
                            allQs.push(...catsData[cat]);
                        }
                        if (allQs.length > 0) randomQ = allQs[Math.floor(Math.random() * allQs.length)];
                    } else {
                        const catNames = Object.keys(catsData).filter(c => c !== "Без категории" && catsData[c].length > 0);
                        const catIndex = parseInt(catIdentifier);
                        const actualCatName = catNames[catIndex];
                        if (actualCatName) {
                            const catQs = catsData[actualCatName];
                            if (catQs && catQs.length > 0) randomQ = catQs[Math.floor(Math.random() * catQs.length)];
                        }
                    }

                    pair.question = { text: randomQ, photoId: null, senderName: "Каталог", senderId: userId };
                    pair.answers = {};
                    await env.DB.put(pId, JSON.stringify(pair));

                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));

                    for (const id of pair.users) {
                        const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить`, callback_data: `ans_${pId}` }]] };
                        if (id == userId) {
                            await sendPhoto(env.BOT_TOKEN, id, "https://i.ibb.co/F4J88zZ9/Frame-53.png", `🎲 **Ты выбрал(а) новый вопрос из каталога!**\n\n${randomQ}`, ansBtn);
                        } else {
                            let partnerProfile = await env.DB.get(`user_${id}`, 'json');
                            let myNameForPartner = partnerProfile ? (partnerProfile.pairs[pId] || user.name) : user.name;
                            await sendPhoto(env.BOT_TOKEN, id, "https://i.ibb.co/F4J88zZ9/Frame-53.png", `🎲 **${myNameForPartner} выбрал(а) новый вопрос из каталога!**\n\nДавайте ответим:\n\n${randomQ}`, ansBtn);
                        }
                    }
                }
            }

            await answerCallbackQuery(env.BOT_TOKEN, cq.id);
            return new Response('OK');
        }

        // ==========================================
        // БЛОК 2: ОБРАБОТКА ОБЫЧНЫХ СООБЩЕНИЙ
        // ==========================================
        if (!payload.message) return new Response('OK');

        const message = payload.message;
        const chatId = message.chat.id;
        const userId = message.from.id;

        const text = message.text || message.caption || '';
        const photoId = message.photo ? message.photo[message.photo.length - 1].file_id : null;

        let user = await env.DB.get(`user_${userId}`, 'json');
        if (!user) {
            user = { id: userId, name: message.from.first_name, state: 'IDLE', pairs: {} };
        } else {
            user.name = message.from.first_name;
        }

        if (user.state === 'BANNED') return new Response('OK'); // Забаненные идут лесом

        let isMaintenance = await env.DB.get('global_maintenance');
        if (isMaintenance === 'ON' && userId !== ADMIN_ID) {
            await sendMessage(env.BOT_TOKEN, chatId, "⚙️ **Бот обновляется!**\n\nМы добавляем новые крутые фичи. Вернемся через 10-15 минут, подождите совсем немного!");
            return new Response('OK'); // Останавливаем выполнение для обычных юзеров
        }

        // СОБИРАЕМ АДМИН-МЕНЮ ЗДЕСЬ (КОГДА ВСЕ ПЕРЕМЕННЫЕ УЖЕ ИЗВЕСТНЫ)
        const adminMenu = {
            keyboard: [
                [{ text: "🚀 Создать рассылку" }, { text: "📈 Статистика бота" }],
                [{ text: "🔍 Найти юзера" }, { text: "Получить ID" }],
                [{ text: isMaintenance === 'ON' ? "🛠 Тех. работы: ВКЛ" : "🛠 Тех. работы: ВЫКЛ" }, { text: "❌ Выйти в меню" }]
            ],
            resize_keyboard: true, persistent: true
        };

        const pairKeys = Object.keys(user.pairs || {});
        const partnerName = pairKeys.length === 1 ? user.pairs[pairKeys[0]] : null;

        const settingsMenu = {
            keyboard: [
                [{ text: "🔗 Пригласить партнера" }, { text: "👫 Настройки пары" }],
                [{ text: "🔄 Сбросить вопрос" }, { text: "🔁 Повторить вопрос" }],
                [{ text: "🆘 Поддержка" }, { text: "🗂 Главное меню" }]
            ],
            resize_keyboard: true, persistent: true
        };
        const cancelMenu = { keyboard: [[{ text: "❌ Отмена" }]], resize_keyboard: true };

        const isUnsupported = message.animation || message.sticker || message.document || message.audio;
        if (isUnsupported && user.state !== 'IDLE') {
            await sendMessage(env.BOT_TOKEN, chatId, "⚠️ **Бот не поддерживает этот формат.**\n\nПожалуйста, отправь текст, кружочек, голосовое сообщение или обычное фото (не файлом).", cancelMenu);
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: ВХОД И ВЫХОД ---
        if (text === '/admin') {
            if (userId === ADMIN_ID) {
                user.state = 'ADMIN_MODE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                await sendMessage(env.BOT_TOKEN, chatId, "🔐 Добро пожаловать в панель управления, Дмитро!\n\nВы переведены в режим администратора.", adminMenu);
            }
            return new Response('OK');
        }

        if (text === "❌ Выйти в меню" && user.state === 'ADMIN_MODE') {
            user.state = 'IDLE';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            await sendMessage(env.BOT_TOKEN, chatId, "Вы вышли из режима администратора.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: СТАТИСТИКА БОТА ---
        if (text === "📈 Статистика бота" && user.state === 'ADMIN_MODE') {
            await sendMessage(env.BOT_TOKEN, chatId, "⏳ Собираю данные...", adminMenu);

            // Запрашиваем списки ключей (без распаковки их содержимого)
            const usersList = await env.DB.list({ prefix: 'user_' });
            const pairsList = await env.DB.list({ prefix: 'pair_' });

            const totalUsers = usersList.keys.length;
            const totalPairs = pairsList.keys.length;

            const statsText = `📈 **Статистика проекта:**\n\n` +
                `👥 Пользователей: ${totalUsers}\n` +
                `🔗 Активных пар: ${totalPairs}`;

            await sendMessage(env.BOT_TOKEN, chatId, statsText, adminMenu);
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: ТЕХ РАБОТЫ ---
        if ((text === "🛠 Тех. работы: ВЫКЛ" || text === "🛠 Тех. работы: ВКЛ") && user.state === 'ADMIN_MODE') {
            const newState = (isMaintenance === 'ON') ? 'OFF' : 'ON';
            await env.DB.put('global_maintenance', newState);

            // Пересобираем меню для смены текста на кнопке
            const newMenu = { ...adminMenu };
            newMenu.keyboard[1][1].text = newState === 'ON' ? "🛠 Тех. работы: ВКЛ" : "🛠 Тех. работы: ВЫКЛ";

            await sendMessage(env.BOT_TOKEN, chatId, `Режим технических работ переключен на: **${newState}**`, newMenu);
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: ПОИСК ЮЗЕРА ---
        if (text === "🔍 Найти юзера" && user.state === 'ADMIN_MODE') {
            user.state = 'ADMIN_WAITING_USER_ID';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            await sendMessage(env.BOT_TOKEN, chatId, "Введи Telegram ID пользователя (только цифры):", cancelMenu);
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: РАССЫЛКА ---
        if (text === "🚀 Создать рассылку" && user.state === 'ADMIN_MODE') {
            user.state = 'ADMIN_WAITING_BROADCAST';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            await sendMessage(env.BOT_TOKEN, chatId, "Отправь мне пост для рассылки (картинка, а в описании — нужный текст):", cancelMenu);
            return new Response('OK');
        }

        // --- АДМИН ПАНЕЛЬ: ПОЛУЧИТЬ ID ФАЙЛА ---
        if (text === "Получить ID" && user.state === 'ADMIN_MODE') {
            user.state = 'ADMIN_WAITING_FOR_FILE';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            await sendMessage(env.BOT_TOKEN, chatId, "Отправь мне файл (фото, голосовое или кружочек), и я выдам его ID:", cancelMenu);
            return new Response('OK');
        }

        // --- КОМАНДА /START ---
        if (text.startsWith('/start')) {
            const parts = text.split(' ');
            if (parts.length > 1) {
                const partnerId = parseInt(parts[1]);
                if (partnerId === userId) {
                    await sendMessage(env.BOT_TOKEN, chatId, "Ты не можешь создать пару сам с собой 😅", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                } else {
                    const pairId = `pair_${Math.min(userId, partnerId)}_${Math.max(userId, partnerId)}`;
                    let partner = await env.DB.get(`user_${partnerId}`, 'json');

                    if (partner) {
                        // Переводим в режим ожидания ввода имени
                        user.state = `WAITING_RENAME_${partnerId}`;
                        await env.DB.put(`user_${userId}`, JSON.stringify(user));

                        const renameMenu = {
                            keyboard: [[{ text: `Оставить "${partner.name}"` }]],
                            resize_keyboard: true
                        };
                        await sendMessage(env.BOT_TOKEN, chatId, `Почти готово! Как ты хочешь подписать партнера (его имя в ТГ: ${partner.name})?\n\nНапиши ласковое имя в чат или нажми кнопку ниже 👇`, renameMenu);
                        return new Response('OK');
                    }
                }
            } else {
                // 1. Отправляем маркетинговый текст и главное фото
                const marketingText = "Привет! Готовы к честному разговору? 🤫\n\nЭто ваш личный тренажер близости. Задавайте вопросы, на которые сложно ответить в лицо.\n\nГлавное правило: никто не увидит ответы, пока оба партнера не выскажутся. Никакого давления и стеснения — только искренность.\n\nСделай первый шаг: пригласи партнера по ссылке ниже и начните игру!";

                // Отправляем первое фото (без клавиатуры, чтобы она не дублировалась)
                await sendPhoto(
                    env.BOT_TOKEN,
                    chatId,
                    "https://i.ibb.co/kVScTNv3/Frame-61.png",
                    marketingText
                );

                // 2. СРАЗУ генерируем и отправляем пригласительную ссылку
                const inviteLink = `https://t.me/${env.BOT_USERNAME}?start=${userId}`;

                // Отправляем второе фото с ссылкой и прикрепляем главное меню
                await sendPhoto(
                    env.BOT_TOKEN,
                    chatId,
                    "https://i.ibb.co/KjgbCx2f/Frame-55.png",
                    `Вот твоя ссылка! Просто перешли её партнеру:\n\n${inviteLink}`,
                    getMainMenuKeyboard(partnerName, pairKeys.length > 0)
                );
            }
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            return new Response('OK');
        }

        if (text === "⏳ Ответить позже") {
            // Выводим пользователя из режима ожидания ответа
            user.state = 'IDLE';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));

            // Отправляем инструкцию, как потом вернуться к вопросу
            await sendMessage(
                env.BOT_TOKEN,
                chatId,
                "Хорошо! Вопрос никуда не пропадет.\nКогда будешь готов ответить, нажми **⚙️ Настройки -> 🔁 Повторить вопрос**.",
                getMainMenuKeyboard(partnerName, pairKeys.length > 0)
            );
            return new Response('OK');
        }

        if (text === "❌ Отмена") {
            // Если мы были в процессе задания или ответа на вопрос — очищаем базу пары
            if (user.state.startsWith('WAITING_QUESTION_') || user.state.startsWith('WAITING_ANSWER_')) {
                const pId = user.state.split('_').slice(2).join('_'); // Вытаскиваем ID пары из состояния
                let pair = await env.DB.get(pId, 'json');
                if (pair) {
                    pair.question = null; // Удаляем активный вопрос
                    pair.answers = {};    // Удаляем все текущие ответы
                    await env.DB.put(pId, JSON.stringify(pair)); // Сохраняем "чистую" пару в базу
                }
            }

            user.state = 'IDLE';
            await env.DB.put(`user_${userId}`, JSON.stringify(user));
            await sendMessage(env.BOT_TOKEN, chatId, "Действие отменено.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            return new Response('OK');
        }

        // --- ПРОГРЕСС / СТРИКИ ---
        if (text === "🔥 Наш прогресс") {
            if (pairKeys.length === 1) {
                let pair = await env.DB.get(pairKeys[0], 'json');
                if (pair) {
                    const streak = pair.current_streak || 0;
                    await sendMessage(env.BOT_TOKEN, chatId, `🔥 Ваш текущий стрик с партнером: **${streak} дней подряд**!\n\nПродолжайте отвечать на вопросы каждый день, чтобы не потерять прогресс.`, getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                }
            } else {
                await sendMessage(env.BOT_TOKEN, chatId, "У вас нет активной пары для проверки прогресса.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            }
            return new Response('OK');
        }

        // --- ОБРАБОТКА МЕНЮ ---
        if (text === "⚙️ Настройки") {
            await sendMessage(env.BOT_TOKEN, chatId, "⚙️ Настройки:", settingsMenu);
            return new Response('OK');
        }

        if (text === "🗂 Главное меню") {
            await sendMessage(env.BOT_TOKEN, chatId, "🔙 Главное меню", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            return new Response('OK');
        }

        if (text === "🆘 Поддержка") {
            await sendPhoto(
                env.BOT_TOKEN,
                chatId,
                "https://i.ibb.co/0yRNLP7d/Frame-57.png",
                "🆘 По всем вопросам/предложениям или техническим проблемам обращайтесь - @gde\\_malish 🛠",
                settingsMenu
            );
            return new Response('OK');
        }

        // --- НАСТРОЙКИ ПАРЫ ---
        if (text === "👫 Настройки пары") {
            if (pairKeys.length === 0) {
                await sendMessage(env.BOT_TOKEN, chatId, "У тебя еще нет активных пар.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            } else {
                const pairSettingsMenu = {
                    keyboard: [
                        [{ text: "✏️ Изменить имя" }, { text: "📊 Статистика" }],
                        [{ text: "✂️ Удалить пару" }, { text: "🔙 Назад в настройки" }]
                    ],
                    resize_keyboard: true, persistent: true
                };
                await sendMessage(env.BOT_TOKEN, chatId, "⚙️ **Настройки пары**\n\nВыбери действие ниже 👇", pairSettingsMenu);
            }
            return new Response('OK');
        }

        if (text === "🔙 Назад в настройки") {
            await sendMessage(env.BOT_TOKEN, chatId, "⚙️ Настройки:", settingsMenu);
            return new Response('OK');
        }
        if (text === "✏️ Изменить имя") {
            const pId = pairKeys[0];
            if(pId) {
                user.state = `WAITING_RENAME_${pId}`;
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                await sendMessage(env.BOT_TOKEN, chatId, "Как ты хочешь подписать партнера?", { keyboard: [[{ text: "❌ Отмена" }]], resize_keyboard: true });
            }
            return new Response('OK');
        }
        if (text === "📊 Статистика") {
            const pId = pairKeys[0];
            if(pId) {
                const pair = await env.DB.get(pId, 'json');
                await sendMessage(env.BOT_TOKEN, chatId, `📊 В паре с **${user.pairs[pId]}** вы ответили на **${pair.count}** вопросов!`);
            }
            return new Response('OK');
        }
        if (text === "✂️ Удалить пару") {
            const pId = pairKeys[0];
            if(pId) {
                user.state = `WAITING_DELETE_${pId}`;
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                await sendMessage(env.BOT_TOKEN, chatId, `⚠️ Вы уверены, что хотите разорвать пару с **${user.pairs[pId]}**?\n\nВся история ваших ответов будет удалена навсегда.`, { keyboard: [[{ text: "✅ Да, удалить" }, { text: "❌ Отмена" }]], resize_keyboard: true });
            }
            return new Response('OK');
        }

        // --- ЛОГИКА СБРОСА ВОПРОСА ---
        if (text === "🔄 Сбросить вопрос") {
            const pId = pairKeys[0];
            if (!pId) {
                await sendMessage(env.BOT_TOKEN, chatId, "У тебя еще нет активных пар.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            } else {
                let pair = await env.DB.get(pId, 'json');

                if (pair.answers && Object.keys(pair.answers).length > 0) {
                    if (pair.answers[userId]) {
                        await sendMessage(env.BOT_TOKEN, chatId, "Возвращаю в главное меню...", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                        const nudgeMenu = { inline_keyboard: [[{ text: `🔔 Напомнить партнеру`, callback_data: `nudge_${pId}` }]] };
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Ты уже ответил на этот вопрос! Сбрасывать его нечестно. Лучше пни партнера!", nudgeMenu);
                    } else {
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Твой партнер уже ответил на этот вопрос и ждет твоей реакции! Будет обидно сбросить его сейчас. Давай, смелее отвечай! 😉", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                        const authorName = (pair.question.senderId == userId) ? "тебя" : user.pairs[pId];
                        const qText = `🔁 **Напоминание! Вопрос от ${authorName}:**\n\n_${pair.question.text || '📸 Фото-вопрос'}_\n\nЖдем твой ответ! 👇`;
                        const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить`, callback_data: `ans_${pId}` }]] };
                        if (pair.question.photoId) { await sendPhoto(env.BOT_TOKEN, chatId, pair.question.photoId); }
                        await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/F4J88zZ9/Frame-53.png", qText, ansBtn);
                    }
                    return new Response('OK');
                }

                const partnerId = pair.users.find(id => id != userId);
                if (partnerId) {
                    let partnerUser = await env.DB.get(`user_${partnerId}`, 'json');
                    if (partnerUser && partnerUser.state && partnerUser.state.startsWith('WAITING_ANSWER_')) {
                        partnerUser.state = 'IDLE';
                        await env.DB.put(`user_${partnerId}`, JSON.stringify(partnerUser));
                    }
                    await sendMessage(env.BOT_TOKEN, partnerId, "⚠️ Ваш партнер сбросил текущий вопрос.\n\nВы можете выбрать новую тему!", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                }

                pair.question = null;
                pair.answers = {};
                await env.DB.put(pId, JSON.stringify(pair));
                await sendMessage(env.BOT_TOKEN, chatId, "✅ Активный вопрос сброшен! Теперь вы можете задать новый.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            }
            return new Response('OK');
        }

        // --- ЛОГИКА ПОВТОРЕНИЯ ВОПРОСА ---
        if (text === "🔁 Повторить вопрос") {
            const pId = pairKeys[0];
            if (!pId) {
                await sendMessage(env.BOT_TOKEN, chatId, "У тебя еще нет активных пар.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            } else {
                let pair = await env.DB.get(pId, 'json');

                if (!pair || !pair.question) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Сейчас нет активного вопроса.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                } else if (pair.answers && pair.answers[userId]) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⏳ Ты уже ответил на этот вопрос! Ждем партнера.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                } else {
                    const authorName = (pair.question.senderId == userId) ? "тебя" : user.pairs[pId];
                    const qText = `🔁 **Напоминание! Вопрос от ${authorName}:**\n\n_${pair.question.text || '📸 Фото-вопрос'}_\n\nЖдем твой ответ! 👇`;
                    const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить`, callback_data: `ans_${pId}` }]] };

                    await sendMessage(env.BOT_TOKEN, chatId, "Лови активный вопрос 👇", getMainMenuKeyboard(partnerName, pairKeys.length > 0));

                    if (pair.question.photoId) {
                        await sendPhoto(env.BOT_TOKEN, chatId, pair.question.photoId);
                    }

                    await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/F4J88zZ9/Frame-53.png", qText, ansBtn);
                }
            }
            return new Response('OK');
        }

        if (text === "🔗 Пригласить партнера") {
            const inviteLink = `https://t.me/${env.BOT_USERNAME}?start=${userId}`;
            await sendPhoto(
                env.BOT_TOKEN,
                chatId,
                "https://i.ibb.co/KjgbCx2f/Frame-55.png",
                `Перешли эту ссылку партнеру:\n\n${inviteLink}`,
                getMainMenuKeyboard(partnerName, pairKeys.length > 0)
            );
            return new Response('OK');
        }

        if (pairKeys.length === 0 && (text === "🎯 Задать вопрос" || text === "📚 Выбрать тему" || text === "📊 Статистика")) {
            await sendMessage(env.BOT_TOKEN, chatId, "Сначала нужно создать пару! Нажми «Пригласить партнера».", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            return new Response('OK');
        }

        function makeInlineKeyboard(prefix) {
            const kb = [];
            for (const [pId, pName] of Object.entries(user.pairs)) {
                kb.push([{ text: pName, callback_data: `${prefix}_${pId}` }]);
            }
            return { inline_keyboard: kb };
        }

        // --- ЗАДАТЬ ВОПРОС ---
        if (text === "🎯 Задать вопрос") {
            if (pairKeys.length === 1) {
                const pId = pairKeys[0];
                const pair = await env.DB.get(pId, 'json');

                if (pair && pair.question) {
                    if (pair.answers && pair.answers[userId]) {
                        const nudgeMenu = { inline_keyboard: [[{ text: `🔔 Напомнить партнеру`, callback_data: `nudge_${pId}` }]] };
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ У вас уже есть активный вопрос, и ты на него ответил! Пнуть партнера?", nudgeMenu);
                    } else {
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Уже есть активный вопрос! Сначала тебе нужно на него ответить.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    }
                    return new Response('OK');
                }

                user.state = `WAITING_QUESTION_${pId}`;
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/qM82VKr0/Frame-54.png", `📝 Напиши свой вопрос для **${user.pairs[pId]}** 👇\n\nМожно задать:\n— Текстом\n— Картинкой`, cancelMenu);
            } else {
                await sendPhoto(
                    env.BOT_TOKEN,
                    chatId,
                    "https://i.ibb.co/qM82VKr0/Frame-54.png",
                    "Кому задаем вопрос?",
                    makeInlineKeyboard('ask')
                );
            }
            return new Response('OK');
        }



        if (text === "🗂 Каталог тем") {
            await sendMessage(env.BOT_TOKEN, chatId, "Меню бота было обновлено! Пожалуйста, используйте новую клавиатуру 👇", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
            return new Response('OK');
        }

        // --- КАТАЛОГ ТЕМ ---
        if (text === "📚 Выбрать тему") {
            if (pairKeys.length === 1) {
                const pId = pairKeys[0];
                let pair = await env.DB.get(pId, 'json');

                if (pair && pair.question) {
                    if (pair.answers && pair.answers[userId]) {
                        const nudgeMenu = { inline_keyboard: [[{ text: `🔔 Напомнить партнеру`, callback_data: `nudge_${pId}` }]] };
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ У вас уже есть активный вопрос, и ты на него ответил! Пнуть партнера?", nudgeMenu);
                    } else {
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Уже есть активный вопрос! Сначала тебе нужно на него ответить.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    }
                    return new Response('OK');
                }

                user.state = `BROWSING_CATEGORIES_${pId}`;
                await env.DB.put(`user_${userId}`, JSON.stringify(user));

                const kb = await showCatalog(1, pId);
                await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/F4J88zZ9/Frame-53.png", "🗂 **Каталог тем**\n\nВыберите категорию для вопроса:", kb);
            } else {
                await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/qM82VKr0/Frame-54.png", "Для какой пары открыть каталог?", makeInlineKeyboard('cat'));
            }
            return new Response('OK');
        }

        // ==========================================
        // БЛОК 3: ЛОВИМ ВВОД ВОПРОСА, ОТВЕТА ИЛИ ИМЕНИ
        // ==========================================
        if (user.state !== 'IDLE') {

            // --- ЛОВИМ ВВОД ID ДЛЯ ДОСЬЕ ---
            if (user.state === 'ADMIN_WAITING_USER_ID') {
                const targetId = parseInt(text);
                if (isNaN(targetId)) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Ошибка. Нужно ввести числовой ID.", adminMenu);
                } else {
                    let targetUser = await env.DB.get(`user_${targetId}`, 'json');
                    if (!targetUser) {
                        await sendMessage(env.BOT_TOKEN, chatId, "❌ Пользователь с таким ID не найден в базе.", adminMenu);
                    } else {
                        const pairsCount = Object.keys(targetUser.pairs || {}).length;
                        const isBanned = targetUser.state === 'BANNED';
                        const msg = `👤 **ДОСЬЕ НА ЮЗЕРА**\n\nID: \`${targetUser.id}\`\nИмя: ${targetUser.name}\nСостояние (State): ${targetUser.state}\nКол-во пар: ${pairsCount}`;

                        const kb = { inline_keyboard: [[{ text: isBanned ? "✅ Разбанить" : "🚫 Забанить", callback_data: isBanned ? `unban_${targetId}` : `ban_${targetId}` }]] };
                        await sendMessage(env.BOT_TOKEN, chatId, msg, kb);
                    }
                }
                user.state = 'ADMIN_MODE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                return new Response('OK');
            }

            // --- ЛОВИМ ПОСТ ДЛЯ РАССЫЛКИ ---
            if (user.state === 'ADMIN_WAITING_BROADCAST') {
                if (!photoId) {
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Пожалуйста, отправь именно ФОТО с текстом в описании.", adminMenu);
                } else {
                    await env.DB.put('temp_broadcast', JSON.stringify({ photoId: photoId, caption: text }));

                    const previewBtn = { inline_keyboard: [[{ text: "✅ Запустить", callback_data: "bc_start" }, { text: "❌ Отмена", callback_data: "bc_cancel" }]] };
                    await sendPhoto(env.BOT_TOKEN, chatId, photoId, `👀 **ПРЕДПРОСМОТР РАССЫЛКИ:**\n\n${text}`, previewBtn);
                }
                user.state = 'ADMIN_MODE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));
                return new Response('OK');
            }

            // --- ОБРАБОТКА ПОЛУЧЕНИЯ ФАЙЛА ДЛЯ ID ---
            if (user.state === 'ADMIN_WAITING_FOR_FILE') {
                let fileId = null;

                if (message.photo && message.photo.length > 0) {
                    fileId = message.photo[message.photo.length - 1].file_id;
                } else if (message.voice) {
                    fileId = message.voice.file_id;
                } else if (message.video_note) {
                    fileId = message.video_note.file_id;
                } else if (message.video) {
                    fileId = message.video.file_id;
                } else if (message.document) {
                    fileId = message.document.file_id;
                }

                if (fileId) {
                    await sendMessage(env.BOT_TOKEN, chatId, "✅ Картинка/файл успешно приняты, ID получен.");
                    await sendMessage(env.BOT_TOKEN, chatId, fileId);
                    // Оставляем в состоянии ADMIN_WAITING_FOR_FILE для удобства отправки подряд
                    return new Response('OK');
                } else {
                    await sendMessage(env.BOT_TOKEN, chatId, "Пожалуйста, отправь медиафайл (фото, видео, кружочек или голосовое).");
                    return new Response('OK');
                }
            }

            // --- ЗАЩИТА: ЕСЛИ ЭТО АДМИН ПИШЕТ ТЕКСТ, ПРОСТО ИГНОРИРУЕМ ---
            if (user.state === 'ADMIN_MODE') {
                await sendMessage(env.BOT_TOKEN, chatId, "Используй кнопки админ-панели 👇", adminMenu);
                return new Response('OK');
            }

            const stateParts = user.state.split('_');
            const action = stateParts[1];
            const pId = stateParts.slice(2).join('_');

            // --- ЛОГИКА ПЕРЕИМЕНОВАНИЯ ПАРТНЕРА ---
            if (action === 'RENAME') {
                if (!text) {
                    await sendMessage(env.BOT_TOKEN, chatId, "Пожалуйста, отправь текст или нажми кнопку.");
                    return new Response('OK');
                }

                let customName = text.replace(/[_*[\]`]/g, '');
                let pairId;
                let partnerId;

                if (pId.startsWith('pair_')) {
                    // Переименование из Настроек (pId = pair_X_Y)
                    pairId = pId;
                    const parts = pairId.split('_');
                    partnerId = (parts[1] == userId) ? parts[2] : parts[1];
                    let partner = await env.DB.get(`user_${partnerId}`, 'json');
                    if (text.startsWith('Оставить "')) customName = partner ? partner.name : "Партнер";

                    user.pairs[pairId] = customName;
                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));

                    await sendMessage(env.BOT_TOKEN, chatId, `✅ Имя успешно изменено на **${customName}**.`, getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    return new Response('OK');
                } else {
                    // Первичное создание пары (pId = partnerId)
                    partnerId = parseInt(pId);
                    let partner = await env.DB.get(`user_${partnerId}`, 'json');

                    if (!partner) {
                        user.state = 'IDLE';
                        await env.DB.put(`user_${userId}`, JSON.stringify(user));
                        await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Ошибка: партнер не найден.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                        return new Response('OK');
                    }

                    if (text.startsWith('Оставить "')) customName = partner.name;

                    pairId = `pair_${Math.min(userId, partnerId)}_${Math.max(userId, partnerId)}`;

                    user.pairs[pairId] = customName;
                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));

                    let pair = await env.DB.get(pairId, 'json');
                    if (!pair) {
                        pair = { users: [userId, partnerId], question: null, answers: {}, count: 0 };
                        await env.DB.put(pairId, JSON.stringify(pair));

                        partner.state = `WAITING_RENAME_${userId}`;
                        await env.DB.put(`user_${partnerId}`, JSON.stringify(partner));

                        const partnerRenameMenu = {
                            keyboard: [[{ text: `Оставить "${user.name}"` }]],
                            resize_keyboard: true
                        };
                        await sendMessage(env.BOT_TOKEN, partnerId, `🎉 **${user.name}** перешел по твоей ссылке!\n\nКак ты хочешь подписать этого партнера у себя? Напиши имя в чат или нажми кнопку 👇`, partnerRenameMenu);
                    }

                    await sendMessage(env.BOT_TOKEN, chatId, `🎉 Готово! Партнер записан у тебя как **${customName}**.\nТеперь вы можете задавать друг другу вопросы!`, getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    return new Response('OK');
                }
            }

            // --- ЛОГИКА УДАЛЕНИЯ ПАРЫ (ШАГ 2: ИСПОЛНЕНИЕ) ---
            if (action === 'DELETE') {
                if (text === "❌ Отмена") {
                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));
                    await sendMessage(env.BOT_TOKEN, chatId, "Действие отменено.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    return new Response('OK');
                }

                if (text !== "✅ Да, удалить") {
                    await sendMessage(env.BOT_TOKEN, chatId, "Пожалуйста, используйте кнопки на клавиатуре.");
                    return new Response('OK');
                }

                let pair = await env.DB.get(pId, 'json');
                if (!pair) {
                    user.state = 'IDLE';
                    await env.DB.put(`user_${userId}`, JSON.stringify(user));
                    await sendMessage(env.BOT_TOKEN, chatId, "⚠️ Ошибка: пара уже не существует.", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
                    return new Response('OK');
                }

                const partnerId = pair.users.find(id => id != userId);

                await env.DB.delete(pId);

                delete user.pairs[pId];
                user.state = 'IDLE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));

                if (partnerId) {
                    let partnerProfile = await env.DB.get(`user_${partnerId}`, 'json');
                    if (partnerProfile) {
                        let myNameForPartner = partnerProfile.pairs[pId] || user.name;
                        delete partnerProfile.pairs[pId];

                        if (partnerProfile.state.includes(pId)) {
                            partnerProfile.state = 'IDLE';
                        }
                        await env.DB.put(`user_${partnerId}`, JSON.stringify(partnerProfile));

                        await sendPhoto(
                            env.BOT_TOKEN,
                            partnerId,
                            "https://i.ibb.co/0yRNLP7d/Frame-57.png",
                            `⚠️ **${myNameForPartner}** разорвал(а) вашу связь в боте.\n\nИстория ваших ответов удалена, но вы всегда можете пригласить кого-то нового и начать заново!`,
                            getMainMenuKeyboard(null, false)
                        );
                    }
                }

                await sendMessage(env.BOT_TOKEN, chatId, "✂️ Связь успешно разорвана. Вся история удалена.", getMainMenuKeyboard(null, false));
                return new Response('OK');
            }

            let pair = await env.DB.get(pId, 'json');

            if (action === 'QUESTION') {
                if (!text && !photoId) {
                    await sendMessage(env.BOT_TOKEN, chatId, "Пожалуйста, отправь текст или фото.", cancelMenu);
                    return new Response('OK');
                }
                pair.question = { text: text, photoId: photoId, senderId: userId };
                pair.answers = {};
                await env.DB.put(pId, JSON.stringify(pair));

                user.state = 'IDLE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));

                for (const id of pair.users) {
                    if (id == userId) {
                        const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить на свой вопрос`, callback_data: `ans_${pId}` }]] };
                        await sendPhoto(env.BOT_TOKEN, id, "https://i.ibb.co/F4J88zZ9/Frame-53.png", "✅ Вопрос отправлен! Теперь тебе тоже нужно на него ответить 👇", ansBtn);
                    } else {
                        let partnerProfile = await env.DB.get(`user_${id}`, 'json');
                        let myNameForPartner = partnerProfile.pairs[pId] || user.name;

                        const qText = `❓ **Новый вопрос от ${myNameForPartner}:**\n\n${text || '📸 Фото-вопрос'}`;
                        const ansBtn = { inline_keyboard: [[{ text: `📝 Ответить`, callback_data: `ans_${pId}` }]] };

                        if (photoId) {
                            await sendPhoto(env.BOT_TOKEN, id, photoId);
                        }

                        await sendPhoto(env.BOT_TOKEN, id, "https://i.ibb.co/F4J88zZ9/Frame-53.png", qText, ansBtn);
                    }
                }
            }
            else if (action === 'ANSWER') {
                let answerObj = {};
                if (text && !photoId) { answerObj.type = 'text'; answerObj.content = text.replace(/[_*[\]`]/g, ''); }
                else if (photoId) { answerObj.type = 'photo'; answerObj.content = photoId; answerObj.caption = text; }
                else if (message.voice) { answerObj.type = 'voice'; answerObj.content = message.voice.file_id; }
                else if (message.video_note) { answerObj.type = 'video_note'; answerObj.content = message.video_note.file_id; }

                pair.answers[userId] = answerObj;
                await env.DB.put(pId, JSON.stringify(pair));

                user.state = 'IDLE';
                await env.DB.put(`user_${userId}`, JSON.stringify(user));

                await sendPhoto(env.BOT_TOKEN, chatId, "https://i.ibb.co/99tF8PMs/Frame-52.png", "✅ Ответ принят! Ждем партнера...", getMainMenuKeyboard(partnerName, pairKeys.length > 0));

                const answerKeys = Object.keys(pair.answers);
                if (answerKeys.length === 2) {
                    pair.count += 1;
                    pair = updateStreak(pair);
                    const achievements = { 1: "🌱 Первый совместный ответ!", 5: "🔥 5 вопросов позади!", 10: "🏆 Мастера диалога!" };

                    for (const id of pair.users) {
                        const qText = `🎉 **Оба ответили!**\n_Вопрос:_ ${pair.question.text || '📸 Фото-вопрос'}\n\nВаш текущий стрик: ${pair.current_streak} дней подряд 🔥`;

                        await sendPhoto(env.BOT_TOKEN, id, "https://i.ibb.co/JVCSg6b/Frame-56.png", qText);

                        if (pair.question.photoId) {
                            await sendPhoto(env.BOT_TOKEN, id, pair.question.photoId);
                        }

                        let currentReceiver = await env.DB.get(`user_${id}`, 'json');
                        for (const ansId of answerKeys) {
                            const ans = pair.answers[ansId];
                            const displayName = (ansId == id) ? "Ты" : currentReceiver.pairs[pId];

                            if (ans.type === 'text') await sendMessage(env.BOT_TOKEN, id, `🗣 **${displayName}:** ${ans.content}`);
                            else if (ans.type === 'photo') await sendPhoto(env.BOT_TOKEN, id, ans.content, `📸 От **${displayName}**\n${ans.caption}`);
                            else if (ans.type === 'voice') { await sendMessage(env.BOT_TOKEN, id, `🎤 Голосовое от **${displayName}**:`); await sendVoice(env.BOT_TOKEN, id, ans.content); }
                            else if (ans.type === 'video_note') { await sendMessage(env.BOT_TOKEN, id, `📹 Кружочек от **${displayName}**:`); await sendVideoNote(env.BOT_TOKEN, id, ans.content); }
                        }
                        if (achievements[pair.count]) await sendMessage(env.BOT_TOKEN, id, `🎁 **АЧИВКА!** ${achievements[pair.count]}`);

                        if (pair.current_streak === 3) await sendMessage(env.BOT_TOKEN, id, "🌱 Начало положено! Вы общаетесь 3 дня подряд. Так держать!");
                        if (pair.current_streak === 7) await sendMessage(env.BOT_TOKEN, id, "🔥 Неделя искренности! 7 дней подряд вы становитесь ближе друг к другу. Умнички!");
                        if (pair.current_streak === 21) await sendMessage(env.BOT_TOKEN, id, "🏆 Настоящая привычка! 21 день вместе в режиме абсолютного доверия. Вы потрясающая пара! ❤️");
                    }
                    pair.question = null;
                    pair.answers = {};
                    await env.DB.put(pId, JSON.stringify(pair));
                }
            }
            return new Response('OK');
        }

        if (!text.startsWith('/')) {
            await sendMessage(env.BOT_TOKEN, chatId, "Используй кнопки внизу экрана 👇", getMainMenuKeyboard(partnerName, pairKeys.length > 0));
        }
        return new Response('OK');
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(doDailyNudge(env));
    }
};

// ==========================================
// Вспомогательные функции API ТГ (с отловом ошибок)
// ==========================================
async function editMessageReplyMarkup(token, chatId, messageId, replyMarkup) {
    return await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
    });
}

async function apiRequest(token, method, payload, chatId = null) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!data.ok && chatId) {
            const errorMsg = `⚠️ Ошибка Telegram API (${method}):\n${data.description}`;
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: errorMsg
                })
            });
        }
        return data;
    } catch (e) {
        if (chatId) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ Системная ошибка Worker'а:\n${e.message}`
                })
            });
        }
        console.error("Worker fetch error:", e);
    }
}

async function sendMessage(token, chatId, text, markup = null) {
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (markup) payload.reply_markup = markup;
    return await apiRequest(token, 'sendMessage', payload, chatId);
}

async function sendPhoto(token, chatId, photoId, caption = '', markup = null) {
    const payload = { chat_id: chatId, photo: photoId, caption: caption, parse_mode: 'Markdown' };
    if (markup) payload.reply_markup = markup;
    return await apiRequest(token, 'sendPhoto', payload, chatId);
}

async function sendVoice(token, chatId, fileId) {
    const payload = { chat_id: chatId, voice: fileId };
    return await apiRequest(token, 'sendVoice', payload, chatId);
}

async function sendVideoNote(token, chatId, fileId) {
    const payload = { chat_id: chatId, video_note: fileId };
    return await apiRequest(token, 'sendVideoNote', payload, chatId);
}

async function answerCallbackQuery(token, callbackQueryId) {
    const payload = { callback_query_id: callbackQueryId };
    return await apiRequest(token, 'answerCallbackQuery', payload, null);
}

async function deleteMessage(token, chatId, messageId) {
    const payload = { chat_id: chatId, message_id: messageId };
    return await apiRequest(token, 'deleteMessage', payload, chatId);
}

// ==========================================
// ФУНКЦИЯ РАССЫЛКИ (БЕЗ HTTP-КОСТЫЛЕЙ)
// ==========================================
async function doBroadcast(env, photoId, caption, adminId, cursor = null, success = 0, errors = 0) {
    const listData = await env.DB.list({ prefix: 'user_', limit: 35, cursor: cursor });
    let currentSuccess = success;
    let currentErrors = errors;

    const sendPromises = listData.keys.map(async (key) => {
        const uid = key.name.replace('user_', '');
        if (uid == adminId) return;
        try {
            const res = await sendPhoto(env.BOT_TOKEN, uid, photoId, caption);
            if (res && res.ok) currentSuccess++;
            else currentErrors++;
        } catch (e) { currentErrors++; }
    });
    await Promise.all(sendPromises);

    if (!listData.list_complete) {
        await doBroadcast(env, photoId, caption, adminId, listData.cursor, currentSuccess, currentErrors);
    } else {
        const total = currentSuccess + currentErrors;
        const report = `📊 **Рассылка завершена!**\n\n👥 Всего обработано: ${total}\n✅ Успешно доставлено: ${currentSuccess}\n❌ Ошибок/Блокировок: ${currentErrors}`;
        await sendMessage(env.BOT_TOKEN, adminId, report);
    }
}
