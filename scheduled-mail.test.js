const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createScheduledMail } = require('./scheduled-mail');

const key = 'a'.repeat(64);
const account = 'owner@example.com';
const payload = { to: ['recipient@example.com'], subject: 'Notice', text: 'Hello', password: 'secret' };

function storedPassword(db, id) {
    const [nonce, tag, ciphertext] = db.prepare('SELECT payload FROM scheduled_messages WHERE id = ?')
        .get(id).payload.split('.').map(value => Buffer.from(value, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString()).password;
}

test('scheduled messages are scoped to the mailbox and cancellation prevents delivery', async () => {
    const delivered = [];
    const queue = createScheduledMail({ filename: ':memory:', keyHex: key, deliver: async (...args) => delivered.push(args) });
    const id = queue.schedule(account, payload, 1000);
    assert.equal(queue.list('other@example.com').length, 0);
    assert.equal(queue.cancel('other@example.com', id), false);
    assert.equal(queue.cancel(account, id), true);
    await queue.runDue(2000);
    assert.equal(delivered.length, 0);
    assert.equal(queue.list(account)[0].status, 'cancelled');
    queue.close();
});

test('due messages send once and failures remain visible', async () => {
    const delivered = [];
    const queue = createScheduledMail({
        filename: ':memory:', keyHex: key,
        deliver: async (email, message) => {
            delivered.push({ email, message });
            if (message.subject === 'Fail') throw new Error('SMTP unavailable');
        }
    });
    queue.schedule(account, payload, 1000);
    queue.schedule(account, { ...payload, subject: 'Fail' }, 1000);
    await queue.runDue(2000);
    await queue.runDue(2000);
    assert.equal(delivered.length, 2);
    assert.deepEqual(queue.list(account).map(item => item.status).sort(), ['failed', 'sent']);
    assert.equal(queue.list(account).find(item => item.status === 'failed').error, 'SMTP unavailable');
    queue.close();
});

test('terminal jobs discard stored mailbox passwords', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-schedule-'));
    const filename = path.join(directory, 'queue.db');
    try {
        const queue = createScheduledMail({ filename, keyHex: key, deliver: async () => {} });
        const cancelled = queue.schedule(account, payload, 1000);
        const sent = queue.schedule(account, payload, 1000);
        assert.equal(queue.cancel(account, cancelled), true);
        await queue.runDue(2000);
        const db = new Database(filename);
        assert.equal(storedPassword(db, cancelled), undefined);
        assert.equal(storedPassword(db, sent), undefined);
        db.close();
        queue.close();
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('interrupted delivery is not sent again after restart and the key must stay stable', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-schedule-'));
    const filename = path.join(directory, 'queue.db');
    try {
        const initial = createScheduledMail({ filename, keyHex: key, deliver: async () => {} });
        const id = initial.schedule(account, payload, 1000);
        initial.close();
        const db = new Database(filename);
        assert.equal(storedPassword(db, id), 'secret');
        db.prepare("UPDATE scheduled_messages SET status = 'sending' WHERE id = ?").run(id);
        db.close();

        let calls = 0;
        const restarted = createScheduledMail({ filename, keyHex: key, deliver: async () => { calls++; } });
        await restarted.runDue(2000);
        assert.equal(calls, 0);
        assert.equal(restarted.list(account)[0].status, 'uncertain');
        const afterRestart = new Database(filename);
        assert.equal(storedPassword(afterRestart, id), undefined);
        afterRestart.close();
        restarted.close();
        assert.throws(() => createScheduledMail({ filename, keyHex: 'b'.repeat(64), deliver: async () => {} }));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
