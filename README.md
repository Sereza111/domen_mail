# Domain Mail 📧

Веб-приложение для просмотра почты через IMAP с готическим дизайном.

![Domain Mail](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.x-blue) ![License](https://img.shields.io/badge/license-MIT-purple)

## ✨ Возможности

- 📬 Просмотр входящих писем через IMAP
- 🔐 Авторизация по email и паролю
- 📖 Открытие писем в модальном окне
- 🖼️ Поддержка HTML и текстовых писем
- 📎 Отображение информации о вложениях
- 🎨 Готический дизайн интерфейса
- 📱 Адаптивная вёрстка

## 🚀 Установка

### 1. Клонируйте репозиторий

```bash
git clone https://github.com/Sereza111/domen_mail.git
cd domen_mail
```

### 2. Установите зависимости

```bash
npm install
```

### 3. Настройте переменные окружения

Скопируйте файл `.env.example` в `.env`:

```bash
cp .env.example .env
```

Отредактируйте `.env` файл:

```env
# Порт сервера
PORT=3000

# IMAP настройки (для вашего почтового хостинга)
IMAP_HOST=imap.beget.com
IMAP_PORT=993
IMAP_TLS=true
```

### 4. Запустите сервер

```bash
npm start
```

Откройте в браузере: http://localhost:3000

## ⚙️ Настройка IMAP

Приложение поддерживает любой IMAP сервер. Примеры настроек:

### Beget
```env
IMAP_HOST=imap.beget.com
IMAP_PORT=993
IMAP_TLS=true
```

### Gmail
```env
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_TLS=true
```

### Yandex
```env
IMAP_HOST=imap.yandex.ru
IMAP_PORT=993
IMAP_TLS=true
```

### Mail.ru
```env
IMAP_HOST=imap.mail.ru
IMAP_PORT=993
IMAP_TLS=true
```

## 📁 Структура проекта

```
domen_mail/
├── server.js          # Express сервер с IMAP API
├── package.json       # Зависимости проекта
├── .env.example       # Пример настроек
├── public/
│   └── index.html     # Фронтенд (HTML + CSS + JS)
└── README.md
```

## 🔧 API

### POST /api/messages
Получить список писем (до 100 последних)

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "messages": [
    {
      "seqno": 1,
      "subject": "Тема письма",
      "from": "sender@example.com",
      "date": "2024-01-01T12:00:00.000Z",
      "snippet": "Превью текста..."
    }
  ]
}
```

### POST /api/message/:seqno
Получить полное содержимое письма

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": {
    "seqno": 1,
    "subject": "Тема письма",
    "from": "sender@example.com",
    "to": "user@example.com",
    "date": "2024-01-01T12:00:00.000Z",
    "text": "Текст письма...",
    "html": "<html>...</html>",
    "attachments": []
  }
}
```

## 🛡️ Безопасность

- Пароли не хранятся на сервере
- Учётные данные передаются через POST запросы
- HTML содержимое писем санитизируется
- TLS/SSL соединение с IMAP сервером

## 📝 Лицензия

MIT License

## 👤 Автор

[Sereza111](https://github.com/Sereza111)
