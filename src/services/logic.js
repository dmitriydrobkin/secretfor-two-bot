import { sendMessage, sendPhoto } from '../api/telegram.js';
import { kvList, getPair } from '../db/kv.js';

export function updateStreak(pair) {
    const KyivDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
    const todayStr = KyivDate.toISOString().split('T')[0];

    if (!pair.current_streak) pair.current_streak = 0;

    if (!pair.last_reply_date) {
        pair.current_streak = 1;
        pair.last_reply_date = todayStr;
        pair.is_in_recovery = false;
        pair.recovery_needed = 0;
        return pair;
    }

    const lastDate = new Date(pair.last_reply_date);
    const currDate = new Date(todayStr);
    const diffDays = Math.round(Math.abs(currDate - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        if (pair.is_in_recovery && pair.recovery_needed > 0) {
            pair.recovery_needed--;
            if (pair.recovery_needed === 0) {
                pair.current_streak++; // Recovered and answered for today
                pair.is_in_recovery = false;
            }
        }
    } else if (diffDays === 1) {
        if (pair.is_in_recovery) {
            // Failed recovery yesterday
            pair.current_streak = 1;
            pair.is_in_recovery = false;
            pair.recovery_needed = 0;
        } else {
            pair.current_streak++;
        }
    } else if (diffDays > 1 && diffDays <= 4) {
        // Missed 1 to 3 days
        if (pair.is_in_recovery) {
            pair.current_streak = 1;
            pair.is_in_recovery = false;
            pair.recovery_needed = 0;
        } else {
            // Start recovery logic implicitly if they answered without the button
            pair.is_in_recovery = true;
            pair.recovery_needed = diffDays - 1; // because they just answered 1
        }
    } else {
        // > 4 days
        pair.current_streak = 1;
        pair.is_in_recovery = false;
        pair.recovery_needed = 0;
    }

    pair.last_reply_date = todayStr;
    return pair;
}

export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function doDailyNudge(env) {
    const KyivDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
    const todayStr = KyivDate.toISOString().split('T')[0];

    const pairsList = await kvList(env.DB, { prefix: 'pair_' });
    for (const key of pairsList.keys) {
        const pId = key.name;
        const pair = await getPair(env.DB, pId);

        if (pair && pair.users && pair.users.length === 2) {
            if (pair.last_reply_date !== todayStr) {
                let msgText = "🎯 **Новый день — новый вопрос!**\n\nВыбирай тему и задавай вопрос, чтобы огонек общения горел ярче! 🔥";
                
                if (pair.last_reply_date) {
                    const lastDate = new Date(pair.last_reply_date);
                    const currDate = new Date(todayStr);
                    const diffDays = Math.round(Math.abs(currDate - lastDate) / (1000 * 60 * 60 * 24));
                    
                    let kb = null;
                    if (pair.is_in_recovery || pair.streak_at_risk) {
                        msgText = "Пора продолжить разговор! Задавай вопрос и погнали дальше 🚀";
                    } else if (diffDays === 2) {
                        msgText = "Ой, огонек немного приуныл... Но мы можем его спасти! 🔥 Ответь на 2 вопроса сегодня, чтобы вернуть стрик!";
                        kb = { inline_keyboard: [[{ text: "🔥 Спасти стрик", callback_data: `recover_streak_${pId}` }]] };
                    } else if (diffDays === 3) {
                        msgText = "Твой стрик вот-вот угаснет! 😱 Спаси его, ответив на 3 вопроса сегодня.";
                        kb = { inline_keyboard: [[{ text: "🔥 Спасти стрик", callback_data: `recover_streak_${pId}` }]] };
                    } else if (diffDays === 4) {
                        msgText = "Огонек держится из последних сил... 🥺 Ответь на 4 вопроса сегодня, и мы вернем стрик!";
                        kb = { inline_keyboard: [[{ text: "🔥 Спасти стрик", callback_data: `recover_streak_${pId}` }]] };
                    } else if (diffDays > 4) {
                        msgText = "Пора продолжить разговор! Задавай вопрос и погнали дальше 🚀";
                    } else if (diffDays === 1 && pair.current_streak > 0) {
                        msgText += `\n\nТвой стрик (${pair.current_streak} дн.) под угрозой! Спасаем? 🔥`;
                    }
                }

                for (const userId of pair.users) {
                    if (kb) await sendMessage(env.BOT_TOKEN, userId, msgText, kb);
                    else await sendMessage(env.BOT_TOKEN, userId, msgText);
                    await delay(100);
                }
            }
        }
    }
}

export async function doBroadcast(env, photoId, caption, adminId, cursor = null, success = 0, errors = 0) {
    const listData = await kvList(env.DB, { prefix: 'user_', limit: 35, cursor: cursor });
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

export const ACHIEVEMENTS = {
    1: "🌱 Первый совместный ответ!",
    5: "🔥 5 вопросов позади!",
    10: "🏆 Мастера диалога!"
};

export const STREAK_MILESTONES = {
    3: "🌱 Начало положено! Вы общаетесь 3 дня подряд. Так держать!",
    7: "🔥 Неделя искренности! 7 дней подряд вы становитесь ближе друг к другу. Умнички!",
    21: "🏆 Настоящая привычка! 21 день вместе в режиме абсолютного доверия. Вы потрясающая пара! ❤️"
};
