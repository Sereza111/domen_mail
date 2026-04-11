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

## 🌐 Развертывание на сервере

### Вариант 1: VPS/VDS сервер (Ubuntu/Debian)

Это самый распространённый способ. Вам нужен VPS сервер (можно арендовать на Beget, TimeWeb, DigitalOcean и т.д.)

#### 1. Подключитесь к серверу по SSH
```bash
ssh root@your-server-ip
```

#### 2. Установите Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 3. Установите PM2 (менеджер процессов)
```bash
sudo npm install -g pm2
```

#### 4. Клонируйте и настройте проект
```bash
cd /var/www
git clone https://github.com/Sereza111/domen_mail.git
cd domen_mail
npm install
cp .env.example .env
nano .env  # настройте IMAP параметры
```

#### 5. Запустите через PM2
```bash
pm2 start server.js --name "domen_mail"
pm2 save
pm2 startup  # автозапуск при перезагрузке сервера
```

#### 6. Настройте Nginx (для работы на 80/443 порту)
```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/domen_mail
```

Содержимое файла:
```nginx
server {
    listen 80;
    server_name yourdomain.com;  # или IP сервера

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/domen_mail /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Теперь сайт доступен по адресу `http://yourdomain.com` или `http://your-server-ip`

#### 7. (Опционально) Добавьте SSL сертификат
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

### Вариант 2: Railway.app (бесплатно, просто)

1. Зарегистрируйтесь на [railway.app](https://railway.app)
2. Нажмите "New Project" → "Deploy from GitHub repo"
3. Выберите репозиторий `domen_mail`
4. Добавьте переменные окружения (Variables):
   - `PORT` = `3000`
   - `IMAP_HOST` = `imap.beget.com`
   - `IMAP_PORT` = `993`
   - `IMAP_TLS` = `true`
5. Railway автоматически развернёт приложение и даст вам ссылку

---

### Вариант 3: Render.com (бесплатно)

1. Зарегистрируйтесь на [render.com](https://render.com)
2. New → Web Service → Connect GitHub repo
3. Настройки:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Добавьте Environment Variables
5. Deploy!

---

### Полезные команды PM2

```bash
pm2 list              # список процессов
pm2 logs domen_mail   # логи приложения
pm2 restart domen_mail # перезапуск
pm2 stop domen_mail    # остановка
pm2 delete domen_mail  # удаление
```

## 📝 Лицензия

MIT License

## 👤 Автор

[Sereza111](https://github.com/Sereza111)
