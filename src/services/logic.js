import { sendMessage, sendPhoto } from '../api/telegram.js';
import { kvList, getPair } from '../db/kv.js';

export function updateStreak(pair) {
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
