const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function createScheduledMail({ filename, keyHex, deliver }) {
    if (!/^[0-9a-f]{64}$/i.test(keyHex || '')) {
        throw new Error('SCHEDULE_ENCRYPTION_KEY must contain 64 hex characters');
    }
    const key = Buffer.from(keyHex, 'hex');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_messages (
            id TEXT PRIMARY KEY,
            account TEXT NOT NULL,
            payload TEXT NOT NULL,
            send_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_messages(status, send_at);
        CREATE INDEX IF NOT EXISTS scheduled_account ON scheduled_messages(account, created_at);
        CREATE TABLE IF NOT EXISTS schedule_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);

    function encrypt(value) {
        const nonce = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
        return [nonce, cipher.getAuthTag(), ciphertext].map(item => item.toString('base64')).join('.');
    }

    function decrypt(value) {
        const [nonce, tag, ciphertext] = value.split('.').map(item => Buffer.from(item, 'base64'));
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    }

    const keyCheck = db.prepare('SELECT value FROM schedule_meta WHERE key = ?').get('key_check');
    if (keyCheck) {
        let validKey = false;
        try {
            validKey = decrypt(keyCheck.value) === 'mail-schedule-v1';
        } catch {
            validKey = false;
        }
        if (!validKey) {
            db.close();
            throw new Error('Incorrect schedule encryption key');
        }
    } else {
        db.prepare('INSERT INTO schedule_meta (key, value) VALUES (?, ?)')
            .run('key_check', encrypt('mail-schedule-v1'));
    }

    // A crashed SMTP request might already have been accepted. Never retry it automatically.
    const interrupted = db.prepare("SELECT id, payload FROM scheduled_messages WHERE status = 'sending'").all();
    for (const row of interrupted) {
        const { password, ...message } = decrypt(row.payload);
        db.prepare("UPDATE scheduled_messages SET status = 'uncertain', payload = ?, error = ? WHERE id = ?")
            .run(encrypt(message), 'Проверьте папку «Отправленные» перед повторной отправкой', row.id);
    }

    function schedule(account, payload, sendAt) {
        const pending = db.prepare("SELECT COUNT(*) AS total FROM scheduled_messages WHERE account = ? AND status = 'pending'")
            .get(account).total;
        if (pending >= 200) throw new Error('Лимит: 200 отложенных писем на ящик');
        const now = Date.now();
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO scheduled_messages
            (id, account, payload, send_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
            .run(id, account, encrypt(payload), sendAt, now, now);
        return id;
    }

    function list(account) {
        return db.prepare('SELECT * FROM scheduled_messages WHERE account = ? ORDER BY created_at DESC LIMIT 100')
            .all(account).map(row => {
                const payload = decrypt(row.payload);
                return {
                    id: row.id,
                    to: payload.to,
                    subject: payload.subject,
                    sendAt: new Date(row.send_at).toISOString(),
                    createdAt: new Date(row.created_at).toISOString(),
                    status: row.status,
                    error: row.error
                };
            });
    }

    function cancel(account, id) {
        const row = db.prepare("SELECT payload FROM scheduled_messages WHERE id = ? AND account = ? AND status = 'pending'")
            .get(id, account);
        if (!row) return false;
        const { password, ...message } = decrypt(row.payload);
        return db.prepare("UPDATE scheduled_messages SET status = 'cancelled', payload = ?, updated_at = ? WHERE id = ? AND account = ? AND status = 'pending'")
            .run(encrypt(message), Date.now(), id, account).changes === 1;
    }

    let running = false;
    async function runDue(now = Date.now()) {
        if (running) return;
        running = true;
        try {
            const due = db.prepare("SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20")
                .all(now);
            for (const row of due) {
                const claimed = db.prepare("UPDATE scheduled_messages SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'")
                    .run(Date.now(), row.id).changes;
                if (!claimed) continue;
                try {
                    const { password, ...message } = decrypt(row.payload);
                    await deliver(row.account, { ...message, password });
                    db.prepare("UPDATE scheduled_messages SET status = 'sent', payload = ?, error = NULL, updated_at = ? WHERE id = ?")
                        .run(encrypt(message), Date.now(), row.id);
                } catch (error) {
                    const { password, ...message } = decrypt(row.payload);
                    db.prepare("UPDATE scheduled_messages SET status = 'failed', payload = ?, error = ?, updated_at = ? WHERE id = ?")
                        .run(encrypt(message), String(error.message || error).slice(0, 300), Date.now(), row.id);
                }
            }
        } finally {
            running = false;
        }
    }

    return { schedule, list, cancel, runDue, close: () => db.close() };
}

module.exports = { createScheduledMail };
