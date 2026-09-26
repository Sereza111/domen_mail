const $ = id => document.getElementById(id);
let currentEmail = '';
let currentPassword = '';
let messages = [];
let openedMessage = null;
let toastTimer;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function displayDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function toast(message, error = false) {
    const element = $('toast');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 6000);
}

async function api(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, password: currentPassword, ...body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
}

function setView(view) {
    for (const name of ['inbox', 'message', 'compose', 'scheduled']) {
        $(`${name}View`).hidden = name !== view;
    }
    for (const item of document.querySelectorAll('.nav-item')) {
        item.classList.toggle('active', item.dataset.view === (view === 'message' ? 'inbox' : view));
    }
    if (view === 'scheduled') loadScheduled();
    if (view === 'compose') $('toInput').focus();
}

function emptyState(icon, heading, detail) {
    return `<div class="empty-state"><i class="bi ${icon}"></i><strong>${escapeHtml(heading)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function renderMessages() {
    const query = $('messageSearch').value.trim().toLowerCase();
    const filtered = messages.filter(message =>
        [message.from, message.subject, message.snippet].some(value => String(value || '').toLowerCase().includes(query))
    );
    $('inboxCount').textContent = messages.length;
    $('messageCount').textContent = `${filtered.length} из ${messages.length}`;
    $('messageList').innerHTML = filtered.length ? filtered.map(message => `
        <button type="button" class="message-row" data-seqno="${Number(message.seqno)}">
            <i class="bi bi-envelope row-icon"></i>
            <span class="sender">${escapeHtml(message.from || 'Неизвестный отправитель')}</span>
            <span class="subject-line"><strong>${escapeHtml(message.subject || '(Без темы)')}</strong> <span class="snippet">· ${escapeHtml(message.snippet || '')}</span></span>
            <time>${escapeHtml(displayDate(message.date))}</time>
        </button>`).join('') : emptyState('bi-inbox', query ? 'Ничего не найдено' : 'Входящих пока нет', query ? 'Попробуйте другой запрос' : 'Новые письма появятся здесь');
}

async function loadMessages() {
    $('refreshButton').disabled = true;
    if (!currentEmail) return;
    if (!messages.length) $('messageList').innerHTML = emptyState('bi-hourglass-split', 'Загрузка писем', '');
    try {
        const data = await api('/api/messages', {});
        messages = data.messages || [];
        $('loginView').hidden = true;
        $('workspace').hidden = false;
        $('accountEmail').textContent = currentEmail;
        $('connectionStatus').classList.add('connected');
        $('connectionStatus').querySelector('span').textContent = 'Подключено';
        renderMessages();
    } catch (error) {
        toast(error.message, true);
        if ($('workspace').hidden) currentPassword = '';
    } finally {
        $('refreshButton').disabled = false;
    }
}

async function openMessage(seqno) {
    const summary = messages.find(message => message.seqno === seqno);
    if (!summary) return;
    setView('message');
    $('detailSubject').textContent = 'Загрузка письма';
    $('detailMeta').textContent = '';
    $('detailContent').textContent = '';
    try {
        const data = await api(`/api/message/${seqno}`, {});
        openedMessage = data.message;
        $('detailSubject').textContent = openedMessage.subject || '(Без темы)';
        const meta = $('detailMeta');
        for (const [label, value] of [
            ['От', openedMessage.from], ['Кому', openedMessage.to], ['Дата', displayDate(openedMessage.date)]
        ]) {
            const line = document.createElement('div');
            const caption = document.createElement('strong');
            caption.textContent = `${label}: `;
            line.append(caption, document.createTextNode(value || '—'));
            meta.append(line);
        }
        const content = $('detailContent');
        if (openedMessage.html) {
            const frame = document.createElement('iframe');
            frame.className = 'html-frame';
            frame.title = 'Содержимое письма';
            frame.setAttribute('sandbox', '');
            frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">' + openedMessage.html;
            content.append(frame);
        } else {
            const plain = document.createElement('pre');
            plain.textContent = openedMessage.text || '(Нет содержимого)';
            content.append(plain);
        }
        if (openedMessage.attachments?.length) {
            const list = document.createElement('div');
            list.className = 'attachment-list';
            list.textContent = `Вложения (${openedMessage.attachments.length}): `;
            for (const attachment of openedMessage.attachments) {
                const item = document.createElement('span');
                item.textContent = attachment.filename || 'Без имени';
                list.append(item);
            }
            content.append(list);
        }
    } catch (error) {
        $('detailSubject').textContent = summary.subject || '(Без темы)';
        toast(error.message, true);
    }
}

function messageAddress(from) {
    const match = String(from || '').match(/<([^<>]+@[^<>]+)>/);
    return match ? match[1] : String(from || '').trim();
}

function logout() {
    currentEmail = '';
    currentPassword = '';
    messages = [];
    openedMessage = null;
    $('emailInput').value = '';
    $('passwordInput').value = '';
    $('composeForm').reset();
    $('messageList').textContent = '';
    $('detailContent').textContent = '';
    $('scheduledList').textContent = '';
    $('workspace').hidden = true;
    $('loginView').hidden = false;
    $('connectionStatus').classList.remove('connected');
    $('connectionStatus').querySelector('span').textContent = 'Не подключено';
    $('emailInput').focus();
}

async function loadScheduled() {
    $('scheduledList').innerHTML = emptyState('bi-hourglass-split', 'Загрузка очереди', '');
    try {
        const data = await api('/api/scheduled/list', {});
        const labels = { pending: 'Запланировано', sending: 'Отправляется', sent: 'Отправлено', failed: 'Ошибка', uncertain: 'Проверьте отправку', cancelled: 'Отменено' };
        $('scheduledList').innerHTML = data.messages.length ? data.messages.map(item => `
            <div class="scheduled-row">
                <div><span class="scheduled-title">${escapeHtml(item.subject || '(Без темы)')}</span><span class="scheduled-to">${escapeHtml(item.to.join(', '))}</span></div>
                <time>${escapeHtml(displayDate(item.sendAt))}</time>
                <span class="status-badge ${escapeHtml(item.status)}">${labels[item.status] || escapeHtml(item.status)}</span>
                ${item.status === 'pending' ? `<button type="button" class="cancel-button" data-id="${escapeHtml(item.id)}">Отменить</button>` : '<span></span>'}
                ${item.error ? `<span class="scheduled-error">${escapeHtml(item.error)}</span>` : ''}
            </div>`).join('') : emptyState('bi-clock-history', 'Очередь пуста', 'Отложенные письма появятся здесь');
    } catch (error) {
        $('scheduledList').innerHTML = emptyState('bi-exclamation-circle', 'Не удалось загрузить очередь', error.message);
    }
}

$('emailInput').addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text/plain').trim();
    const colon = pasted?.indexOf(':') ?? -1;
    if (colon <= 0 || !pasted.slice(0, colon).includes('@')) return;
    event.preventDefault();
    $('emailInput').value = pasted.slice(0, colon).trim();
    $('passwordInput').value = pasted.slice(colon + 1);
    $('passwordInput').focus();
});

$('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    currentEmail = $('emailInput').value.trim().toLowerCase();
    currentPassword = $('passwordInput').value;
    $('loginButton').disabled = true;
    await loadMessages();
    $('loginButton').disabled = false;
    if (!$('workspace').hidden) setView('inbox');
});

for (const item of document.querySelectorAll('.nav-item')) {
    item.addEventListener('click', () => setView(item.dataset.view));
}
$('logoutButton').addEventListener('click', logout);
$('composeShortcut').addEventListener('click', () => setView('compose'));
$('refreshButton').addEventListener('click', loadMessages);
$('messageSearch').addEventListener('input', renderMessages);
$('messageList').addEventListener('click', event => {
    const row = event.target.closest('[data-seqno]');
    if (row) openMessage(Number(row.dataset.seqno));
});
$('backButton').addEventListener('click', () => setView('inbox'));
$('replyButton').addEventListener('click', () => {
    if (!openedMessage) return;
    $('toInput').value = messageAddress(openedMessage.from);
    $('subjectInput').value = /^re:/i.test(openedMessage.subject) ? openedMessage.subject : `Re: ${openedMessage.subject || ''}`;
    setView('compose');
});
$('refreshScheduledButton').addEventListener('click', loadScheduled);
$('scheduledList').addEventListener('click', async event => {
    const button = event.target.closest('.cancel-button');
    if (!button) return;
    button.disabled = true;
    try {
        await api(`/api/scheduled/${encodeURIComponent(button.dataset.id)}/cancel`, {});
        toast('Отправка отменена');
        await loadScheduled();
    } catch (error) {
        button.disabled = false;
        toast(error.message, true);
    }
});

$('scheduleToggle').addEventListener('change', () => {
    const enabled = $('scheduleToggle').checked;
    $('scheduleFields').hidden = !enabled;
    $('sendAtInput').required = enabled;
    $('sendButtonText').textContent = enabled ? 'Запланировать' : 'Отправить';
    if (enabled) {
        const earliest = new Date(Date.now() + 60000);
        $('sendAtInput').min = new Date(earliest.getTime() - earliest.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
});

$('composeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const scheduled = $('scheduleToggle').checked;
    const sendAt = scheduled ? new Date($('sendAtInput').value) : null;
    if (scheduled && Number.isNaN(sendAt.getTime())) return toast('Выберите дату отправки', true);
    const body = {
        to: $('toInput').value,
        cc: $('ccInput').value,
        bcc: $('bccInput').value,
        subject: $('subjectInput').value,
        text: $('bodyInput').value,
        ...(scheduled ? { sendAt: sendAt.toISOString() } : {})
    };
    $('sendButton').disabled = true;
    try {
        await api(scheduled ? '/api/scheduled' : '/api/send', body);
        $('composeForm').reset();
        $('scheduleFields').hidden = true;
        $('sendButtonText').textContent = 'Отправить';
        toast(scheduled ? 'Письмо добавлено в очередь' : 'Письмо отправлено');
        setView(scheduled ? 'scheduled' : 'inbox');
    } catch (error) {
        toast(error.message, true);
    } finally {
        $('sendButton').disabled = false;
    }
});

fetch('/api/config').then(response => response.json()).then(config => {
    if (!config.scheduledAvailable) {
        $('scheduleToggle').disabled = true;
        $('scheduleToggle').closest('label').title = 'Отложенная отправка не настроена на сервере';
    }
}).catch(() => {});
