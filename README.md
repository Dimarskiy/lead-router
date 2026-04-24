# 🎯 Lead Router — автораспределение лидов Pipedrive

Сервис получает лиды из Pipedrive через webhook, распределяет их по менеджерам по принципу **round-robin** с учётом **правил фильтрации**, и переназначает лид следующему менеджеру, если первый не сделал **касание** за установленное время (по умолчанию 10 минут). Уведомления приходят в **Slack**.

---

## Стек

| Слой | Технология |
|---|---|
| Backend | Node.js + Express |
| База данных | SQLite (через better-sqlite3) |
| Очередь проверок | node-cron (каждую минуту) |
| Frontend | React + Vite |
| CRM | Pipedrive API v1 |
| Уведомления | Slack Bot API |

---

## Быстрый старт

### 1. Клонируй и установи зависимости

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Настрой переменные окружения

```bash
cd backend
cp .env.example .env
# Открой .env и заполни токены
```

Нужные переменные:

```env
PIPEDRIVE_API_TOKEN=ваш_токен           # Pipedrive → Settings → Personal preferences → API
PIPEDRIVE_COMPANY_DOMAIN=yourcompany    # yourcompany из yourcompany.pipedrive.com
SLACK_BOT_TOKEN=xoxb-ваш_токен         # Slack App → OAuth & Permissions
SLACK_DEFAULT_CHANNEL=#sales            # Канал по умолчанию
TIMEOUT_MINUTES=10                      # Время до переназначения
```

### 3. Настрой Slack-бота

1. Перейди на https://api.slack.com/apps → Create New App → From scratch
2. **OAuth & Permissions** → Bot Token Scopes: добавь `chat:write`, `chat:write.public`
3. **Install to Workspace** → скопируй **Bot User OAuth Token** (`xoxb-...`) в `.env`
4. Пригласи бота в нужный канал: `/invite @ИмяБота`

### 4. Запусти

**Режим разработки:**
```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

**Продакшн:**
```bash
# Backend
cd backend
npm start &

# Frontend (собери и раздавай через nginx/caddy)
cd frontend
npm run build
```

### 5. Настрой webhook в Pipedrive

1. Pipedrive → Settings → Webhooks → Add webhook
2. **Event action**: `added`, **Event object**: `lead` (и/или `deal`)
3. **Delivery URL**: `https://ваш-сервер.com/webhook/pipedrive`

---

## Структура проекта

```
lead-router/
├── backend/
│   ├── src/
│   │   ├── index.js           # Express сервер
│   │   ├── db/index.js        # SQLite + схема
│   │   ├── routes/
│   │   │   ├── api.js         # REST API (менеджеры, правила, логи)
│   │   │   └── webhook.js     # Приём событий от Pipedrive
│   │   ├── services/
│   │   │   ├── pipedrive.js   # Pipedrive API клиент
│   │   │   ├── slack.js       # Slack уведомления
│   │   │   └── router.js      # Движок правил + round-robin
│   │   └── workers/
│   │       └── timeout.js     # Фоновая проверка таймаутов (cron)
│   └── .env.example
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.jsx  # Статистика
        │   ├── Managers.jsx   # Список + drag-and-drop очерёдность
        │   ├── Rules.jsx      # Правила фильтрации
        │   ├── Assignments.jsx # Журнал назначений
        │   └── Settings.jsx   # Webhook URL + env справка
        └── api.js             # HTTP-клиент
```

---

## Логика работы

```
Pipedrive → [webhook] → Router Service
                            ↓
                    Проверяет правила (по приоритету)
                            ↓
                    Round-robin в пуле менеджеров
                            ↓
                    Назначает в Pipedrive + уведомляет Slack
                            ↓
              [каждую минуту] Timeout Worker проверяет
                            ↓
              Есть касание? → лид остаётся у менеджера
              Нет касания?  → переназначает следующему
```

**"Касание"** — любое из следующего, созданное после назначения:
- Активность (звонок, письмо, встреча) через `GET /deals/{id}/activities`
- Любое изменение сделки (смена стадии и т.д.) через `GET /deals/{id}/flow`

---

## API Backend

| Метод | Путь | Описание |
|---|---|---|
| GET | /api/managers | Список менеджеров |
| POST | /api/managers | Создать менеджера |
| PUT | /api/managers/:id | Обновить менеджера |
| DELETE | /api/managers/:id | Удалить |
| POST | /api/managers/reorder | Изменить порядок round-robin |
| GET | /api/rules | Список правил |
| POST | /api/rules | Создать правило |
| PUT | /api/rules/:id | Обновить правило |
| DELETE | /api/rules/:id | Удалить правило |
| GET | /api/assignments | Журнал (с фильтрами) |
| GET | /api/assignments/stats | Статистика |
| GET | /api/settings | Настройки |
| PUT | /api/settings | Обновить настройки |
| POST | /webhook/pipedrive | Endpoint для Pipedrive webhook |
| POST | /webhook/trigger | Тестовое назначение по lead_id |

---

## Деплой на VPS

Рекомендуем **Railway**, **Render**, или простой VPS с **PM2**:

```bash
npm install -g pm2
cd backend
pm2 start src/index.js --name lead-router
pm2 save
pm2 startup
```

Для фронтенда собери (`npm run build`) и раздавай папку `dist` через Nginx или Caddy.

---

## Часто задаваемые вопросы

**Q: Лид назначается в Pipedrive автоматически?**
A: Да, если у менеджера заполнен `pipedrive_user_id`, сервис вызывает `PATCH /leads/{id}` с `owner_id`.

**Q: Что если все менеджеры выключены?**
A: Сервис отправит сообщение в Slack-канал по умолчанию о том, что назначить некому.

**Q: Можно ли изменить время таймаута прямо в UI?**
A: Да, на странице «Настройки» — поле «Время до переназначения».
