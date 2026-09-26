require('dotenv').config();
const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { createScheduledMail } = require('./scheduled-mail');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// IMAP settings from environment
const IMAP_HOST = process.env.IMAP_HOST || 'imap.beget.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT) || 993;
const IMAP_TLS = process.env.IMAP_TLS !== 'false';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.beget.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const scheduled = process.env.SCHEDULE_ENCRYPTION_KEY
    ? createScheduledMail({
        filename: process.env.SCHEDULE_DB_PATH || path.join(__dirname, 'scheduled.db'),
        keyHex: process.env.SCHEDULE_ENCRYPTION_KEY,
        deliver: (email, message) => deliverMessage(email, message.password, message)
    })
    : null;

// Parse JSON body
app.use(express.json({ limit: '256kb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

function validEmail(value) {
    return typeof value === 'string' && value.length <= 254 &&
        /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}

function credentials(body) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    if (!validEmail(email) || typeof password !== 'string' || !password || password.length > 256) {
        return null;
    }
    return { email, password };
}

function recipients(value) {
    const addresses = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
    const cleaned = addresses.map(item => String(item).trim()).filter(Boolean);
    if (cleaned.some(item => !validEmail(item))) throw new Error('Проверьте адреса получателей');
    return cleaned;
}

function messageFromBody(body) {
    const to = recipients(body?.to);
    const cc = recipients(body?.cc);
    const bcc = recipients(body?.bcc);
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (to.length === 0 || to.length + cc.length + bcc.length > 20 ||
        subject.length > 200 || !text || text.length > 100000) {
        throw new Error('Укажите получателя и текст письма (не более 20 адресов)');
    }
    return { to, cc, bcc, subject, text };
}

function smtpTransport(email, password) {
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: email, pass: password },
        tls: { rejectUnauthorized: true },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000
    });
}

async function deliverMessage(email, password, message) {
    const transport = smtpTransport(email, password);
    try {
        return await transport.sendMail({
            from: email,
            to: message.to,
            cc: message.cc,
            bcc: message.bcc,
            subject: message.subject,
            text: message.text
        });
    } finally {
        transport.close();
    }
}

function verifyMailbox(email, password) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: email,
            password,
            host: IMAP_HOST,
            port: IMAP_PORT,
            tls: IMAP_TLS,
            tlsOptions: { rejectUnauthorized: true },
            authTimeout: 10000,
            connTimeout: 10000
        });
        let settled = false;
        imap.once('ready', () => {
            if (settled) return;
            settled = true;
            imap.end();
            resolve();
        });
        imap.once('error', error => {
            if (settled) return;
            settled = true;
            imap.destroy();
            reject(error);
        });
        imap.connect();
    });
}

app.get('/api/config', (req, res) => {
    res.json({ scheduledAvailable: Boolean(scheduled) });
});

app.post('/api/send', async (req, res) => {
    const auth = credentials(req.body);
    if (!auth) return res.status(400).json({ error: 'Введите корректный email и пароль' });
    try {
        const message = messageFromBody(req.body);
        const info = await deliverMessage(auth.email, auth.password, message);
        res.json({ success: true, messageId: info.messageId });
    } catch (error) {
        res.status(error.code === 'EAUTH' ? 401 : 400)
            .json({ error: error.code === 'EAUTH' ? 'Неверный email или пароль SMTP' : error.message });
    }
});

app.post('/api/scheduled', async (req, res) => {
    if (!scheduled) return res.status(503).json({ error: 'Отложенная отправка не настроена' });
    const auth = credentials(req.body);
    if (!auth) return res.status(400).json({ error: 'Введите корректный email и пароль' });
    const sendAt = Date.parse(req.body.sendAt);
    if (!Number.isFinite(sendAt) || sendAt < Date.now() + 60000 || sendAt > Date.now() + 30 * 86400000) {
        return res.status(400).json({ error: 'Выберите время от 1 минуты до 30 дней вперёд' });
    }
    try {
        const message = messageFromBody(req.body);
        const transport = smtpTransport(auth.email, auth.password);
        try {
            await transport.verify();
        } finally {
            transport.close();
        }
        const id = scheduled.schedule(auth.email, { ...message, password: auth.password }, sendAt);
        res.status(201).json({ success: true, id });
    } catch (error) {
        res.status(error.code === 'EAUTH' ? 401 : 400)
            .json({ error: error.code === 'EAUTH' ? 'Неверный email или пароль SMTP' : error.message });
    }
});

app.post('/api/scheduled/list', async (req, res) => {
    if (!scheduled) return res.json({ messages: [] });
    const auth = credentials(req.body);
    if (!auth) return res.status(400).json({ error: 'Введите корректный email и пароль' });
    try {
        await verifyMailbox(auth.email, auth.password);
        res.json({ messages: scheduled.list(auth.email) });
    } catch (error) {
        res.status(401).json({ error: 'Не удалось подтвердить доступ к ящику' });
    }
});

app.post('/api/scheduled/:id/cancel', async (req, res) => {
    if (!scheduled) return res.status(503).json({ error: 'Отложенная отправка не настроена' });
    const auth = credentials(req.body);
    if (!auth) return res.status(400).json({ error: 'Введите корректный email и пароль' });
    try {
        await verifyMailbox(auth.email, auth.password);
        if (!scheduled.cancel(auth.email, req.params.id)) {
            return res.status(409).json({ error: 'Письмо уже отправляется или не найдено' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(401).json({ error: 'Не удалось подтвердить доступ к ящику' });
    }
});

// API endpoint to get messages list (POST for security - password in body)
app.post('/api/messages', async (req, res) => {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
        return res.status(400).json({ 
            error: 'Email и пароль обязательны' 
        });
    }

    // Validate email format
    if (!email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ 
            error: 'Введите корректный email адрес' 
        });
    }

    try {
        const messages = await fetchMessages(email, password);
        res.json({ messages });
    } catch (error) {
        console.error('IMAP Error:', error.message);
        
        // User-friendly error messages
        let errorMessage = 'Ошибка при получении сообщений';
        if (error.message.includes('Invalid credentials') || 
            error.message.includes('Authentication failed') ||
            error.message.includes('LOGIN')) {
            errorMessage = 'Неверный email или пароль';
        } else if (error.message.includes('ECONNREFUSED') || 
                   error.message.includes('ETIMEDOUT')) {
            errorMessage = 'Не удалось подключиться к почтовому серверу';
        }
        
        res.status(401).json({ error: errorMessage });
    }
});

// API endpoint to get single message content
app.post('/api/message/:seqno', async (req, res) => {
    const { email, password } = req.body;
    const seqno = parseInt(req.params.seqno);

    // Validate input
    if (!email || !password) {
        return res.status(400).json({ 
            error: 'Email и пароль обязательны' 
        });
    }

    if (!seqno || isNaN(seqno)) {
        return res.status(400).json({ 
            error: 'Неверный номер сообщения' 
        });
    }

    try {
        const message = await fetchSingleMessage(email, password, seqno);
        res.json({ message });
    } catch (error) {
        console.error('IMAP Error:', error.message);
        res.status(500).json({ error: 'Ошибка при получении сообщения' });
    }
});

// Function to fetch messages list from IMAP
function fetchMessages(email, password) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: email,
            password: password,
            host: IMAP_HOST,
            port: IMAP_PORT,
            tls: IMAP_TLS,
            tlsOptions: { rejectUnauthorized: true },
            authTimeout: 10000,
            connTimeout: 10000
        });

        const messages = [];
        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                try { imap.end(); } catch(e) {}
            }
        };

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err, box) => {
                if (err) {
                    cleanup();
                    return reject(err);
                }

                const totalMessages = box.messages.total;
                
                if (totalMessages === 0) {
                    cleanup();
                    return resolve([]);
                }

                // Get all messages (up to 100)
                const start = Math.max(1, totalMessages - 99);
                const range = `${start}:${totalMessages}`;

                const fetch = imap.seq.fetch(range, {
                    bodies: '',
                    struct: true
                });

                let pending = 0;
                let fetchEnded = false;

                fetch.on('message', (msg, seqno) => {
                    pending++;
                    let rawEmail = Buffer.alloc(0);

                    msg.on('body', (stream) => {
                        const chunks = [];
                        stream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });
                        stream.on('end', () => {
                            rawEmail = Buffer.concat(chunks);
                        });
                    });

                    msg.once('end', async () => {
                        try {
                            const parsed = await simpleParser(rawEmail);
                            
                            // Get text snippet (prefer text, fallback to HTML stripped)
                            let snippet = '';
                            if (parsed.text) {
                                snippet = parsed.text.substring(0, 200);
                            } else if (parsed.html) {
                                snippet = parsed.html
                                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                    .replace(/<[^>]+>/g, '')
                                    .replace(/&nbsp;/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                    .substring(0, 200);
                            }
                            
                            if (snippet.length >= 200) {
                                snippet += '...';
                            }

                            messages.push({
                                seqno: seqno,
                                subject: parsed.subject || '(Без темы)',
                                from: parsed.from ? parsed.from.text : 'Неизвестно',
                                date: parsed.date ? parsed.date.toISOString() : '',
                                snippet: snippet || '(Нет содержимого)'
                            });
                        } catch (parseErr) {
                            console.error('Parse error:', parseErr.message);
                            messages.push({
                                seqno: seqno,
                                subject: '(Ошибка парсинга)',
                                from: 'Неизвестно',
                                date: '',
                                snippet: '(Не удалось прочитать письмо)'
                            });
                        }

                        pending--;
                        if (pending === 0 && fetchEnded) {
                            cleanup();
                            // Sort by seqno descending (newest first)
                            messages.sort((a, b) => b.seqno - a.seqno);
                            resolve(messages);
                        }
                    });
                });

                fetch.once('error', (err) => {
                    cleanup();
                    reject(err);
                });

                fetch.once('end', () => {
                    fetchEnded = true;
                    if (pending === 0) {
                        cleanup();
                        messages.sort((a, b) => b.seqno - a.seqno);
                        resolve(messages);
                    }
                });
            });
        });

        imap.once('error', (err) => {
            cleanup();
            reject(err);
        });

        imap.once('end', () => {
            if (!resolved) {
                resolved = true;
            }
        });

        imap.connect();
    });
}

// Function to fetch single message with full content
function fetchSingleMessage(email, password, seqno) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: email,
            password: password,
            host: IMAP_HOST,
            port: IMAP_PORT,
            tls: IMAP_TLS,
            tlsOptions: { rejectUnauthorized: true },
            authTimeout: 10000,
            connTimeout: 10000
        });

        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                try { imap.end(); } catch(e) {}
            }
        };

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err) => {
                if (err) {
                    cleanup();
                    return reject(err);
                }

                const fetch = imap.seq.fetch(seqno, {
                    bodies: '',
                    struct: true
                });

                fetch.on('message', (msg) => {
                    let rawEmail = Buffer.alloc(0);

                    msg.on('body', (stream) => {
                        const chunks = [];
                        stream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });
                        stream.on('end', () => {
                            rawEmail = Buffer.concat(chunks);
                        });
                    });

                    msg.once('end', async () => {
                        try {
                            const parsed = await simpleParser(rawEmail);
                            
                            cleanup();
                            resolve({
                                seqno: seqno,
                                subject: parsed.subject || '(Без темы)',
                                from: parsed.from ? parsed.from.text : 'Неизвестно',
                                to: parsed.to ? parsed.to.text : '',
                                date: parsed.date ? parsed.date.toISOString() : '',
                                text: parsed.text || '',
                                html: parsed.html || '',
                                attachments: (parsed.attachments || []).map(att => ({
                                    filename: att.filename || 'attachment',
                                    contentType: att.contentType,
                                    size: att.size
                                }))
                            });
                        } catch (parseErr) {
                            cleanup();
                            reject(parseErr);
                        }
                    });
                });

                fetch.once('error', (err) => {
                    cleanup();
                    reject(err);
                });

                fetch.once('end', () => {
                    // Will be handled in msg.once('end')
                });
            });
        });

        imap.once('error', (err) => {
            cleanup();
            reject(err);
        });

        imap.connect();
    });
}

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    if (scheduled) {
        setInterval(() => scheduled.runDue().catch(error => console.error('Schedule worker:', error.message)), 15000)
            .unref();
        scheduled.runDue().catch(error => console.error('Schedule worker:', error.message));
    }
    app.listen(PORT, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
}

module.exports = { app };
