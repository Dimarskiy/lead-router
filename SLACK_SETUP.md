# Slack-интеграция — настройка приложения

Lead Router использует Slack для:

- уведомлений о новых лидах с кнопками **Принял / Не могу взять**
- слэш-команды `/leadrouter` (status, pause, resume, help)
- утреннего отчёта, эскалаций и SLA-алертов

## 1. Базовый бот (если ещё не создан)

1. https://api.slack.com/apps → **Create New App** → *From scratch*
2. **OAuth & Permissions** → Bot Token Scopes:
   - `chat:write`
   - `chat:write.public` (чтобы писать в каналы без явного приглашения)
   - `commands`
   - `im:write` (личные сообщения менеджерам)
3. Install to Workspace → скопируй `xoxb-…` токен.

В Railway → переменные окружения бэкенда:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_DEFAULT_CHANNEL=#sales       # fallback-канал для общих алертов
```

## 2. Interactivity (кнопки Принял / Не могу взять)

В настройках Slack-приложения → **Interactivity & Shortcuts** → On.

**Request URL:**
```
https://lead-router-production-b428.up.railway.app/slack/interactive
```

Сохрани.

## 3. Slash commands

**Slash Commands** → *Create New Command*:

| Поле | Значение |
| --- | --- |
| Command | `/leadrouter` |
| Request URL | `https://lead-router-production-b428.up.railway.app/slack/command` |
| Short Description | `Lead Router: статус и пауза` |
| Usage Hint | `[status \| pause [1h] \| resume \| help]` |

Сохрани.

## 4. Reinstall

После добавления scopes/commands жми **Install to Workspace → Reinstall**, иначе токен не получит новых прав.

## 5. Привязка менеджеров

В админке Lead Router → вкладка *Менеджеры* → у каждого менеджера укажи **Slack User ID** (формат `U01ABC123`, копируется в Slack: профиль → ⋯ → Copy member ID).

## 6. Команды

```text
/leadrouter status           — твои активные лиды и статистика за сегодня
/leadrouter pause            — пауза до конца дня
/leadrouter pause 1h         — пауза на 1 час (поддерживается m/h, ч/м)
/leadrouter resume           — снова принимать лиды
/leadrouter help             — справка
```

## 7. Дополнительные настройки в админке

Вкладка *Настройки* содержит:

- **Эскалация**: после скольких переназначений писать тимлиду + Slack ID тимлида
- **SLA-алерты**: при просроченном касании > N часов писать в указанный канал
- **Утренний отчёт**: cron-расписание, канал/получатель, URL админки для кнопки
- **Очередь вне рабочего времени**: складывать ночные лиды в очередь, распределять утром вручную
