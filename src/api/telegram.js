export async function apiRequest(token, method, payload, chatId = null) {
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

export async function sendMessage(token, chatId, text, markup = null) {
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (markup) payload.reply_markup = markup;
    return await apiRequest(token, 'sendMessage', payload, chatId);
}

export async function sendPhoto(token, chatId, photoId, caption = '', markup = null) {
    const payload = { chat_id: chatId, photo: photoId, caption: caption, parse_mode: 'Markdown' };
    if (markup) payload.reply_markup = markup;
    return await apiRequest(token, 'sendPhoto', payload, chatId);
}

export async function sendVoice(token, chatId, fileId) {
    const payload = { chat_id: chatId, voice: fileId };
    return await apiRequest(token, 'sendVoice', payload, chatId);
}

export async function sendVideoNote(token, chatId, fileId) {
    const payload = { chat_id: chatId, video_note: fileId };
    return await apiRequest(token, 'sendVideoNote', payload, chatId);
}

export async function answerCallbackQuery(token, callbackQueryId, options = null) {
    const payload = { callback_query_id: callbackQueryId, ...options };
    return await apiRequest(token, 'answerCallbackQuery', payload, null);
}

export async function deleteMessage(token, chatId, messageId) {
    const payload = { chat_id: chatId, message_id: messageId };
    return await apiRequest(token, 'deleteMessage', payload, chatId);
}

export async function editMessageReplyMarkup(token, chatId, messageId, replyMarkup) {
    return await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
    });
}
