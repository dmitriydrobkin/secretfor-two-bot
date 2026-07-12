export async function kvGet(db, key, type = 'text') {
    return db.get(key, type);
}

export async function kvPut(db, key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return db.put(key, serialized);
}

export async function kvDelete(db, key) {
    return db.delete(key);
}

export async function kvList(db, options = {}) {
    return db.list(options);
}

export async function getUser(db, userId) {
    return kvGet(db, `user_${userId}`, 'json');
}

export async function putUser(db, userId, user) {
    return kvPut(db, `user_${userId}`, user);
}

export async function getPair(db, pairId) {
    return kvGet(db, pairId, 'json');
}

export async function putPair(db, pairId, pair) {
    return kvPut(db, pairId, pair);
}

export async function deletePair(db, pairId) {
    return kvDelete(db, pairId);
}
