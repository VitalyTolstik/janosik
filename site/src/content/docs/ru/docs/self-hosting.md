---
title: Self-hosting
description: Запуск Janosik одним контейнером вместе с PostgreSQL и Redis, от пробного запуска в локальной сети до production за HTTPS.
---

Образ для self-hosting обслуживает весь продукт на одном origin: API по
`/api/v1`, приложение (React SPA) по `/app/` и маркетинговый сайт по `/`.
Отдельный веб-сервер не нужен, а SSE и cookie работают на одном origin.

## Что запускает стек

`docker compose up -d` запускает три контейнера:

| Сервис | Образ | Роль |
| --- | --- | --- |
| `app` | `ghcr.io/vitalytolstik/janosik:${JANOSIK_TAG:-latest}` | Всё приложение: API на NestJS по `/api/v1`, собранное SPA по `/app/`, панель мастера и фоновые задачи. Слушает порт `3000`. |
| `postgres` | `postgres:16-alpine` | База данных: доски, пользователи, журнал команд, аудит. |
| `redis` | `redis:7-alpine` | Очереди задач (почта, транскодирование, обслуживание, экспорт). |

На хост публикуется только порт приложения; `postgres` и `redis` остаются
внутренними. При запуске контейнер `app` применяет миграции базы данных, затем
запускает API.

Контейнер стартует от root только для того, чтобы передать том загрузок
непривилегированному пользователю `node` (тома, созданные старыми образами,
принадлежат root), а затем запускает миграции, API и ffmpeg от `node`. До
этого он проверяет две настройки: отказывается запускаться, пока
`POSTGRES_PASSWORD` равен примерному `change-me`, и выводит напоминание при
каждом запуске, пока `ALLOW_REGISTRATION=true`.

Образ задаёт `STATIC_DIR=/app/public`, `SITE_DIR=/app/site` и
`UI_BASE=/app/`. С этими значениями по умолчанию маркетинговый сайт находится
по `/`, а приложение по `/app/`, поэтому интерфейс доски доступен по
`PUBLIC_ORIGIN/app/`, а панель мастера по `PUBLIC_ORIGIN/app/admin`.

## Требования

- Хост с Docker Engine 24 или новее и плагином Docker Compose v2.
- Порт `3000` доступен для пробного запуска в локальной сети, либо `80` и
  `443`, если впереди стоит обратный прокси (рекомендуется для production).
- Доменное имя для HTTPS (необязательно для пробного запуска, требуется для
  реального использования).

Проверьте хост:

```bash
docker --version
docker compose version
```

Установка Docker на вашу машину описана ниже в разделе
[Установка Docker по операционным системам](#установка-docker-по-операционным-системам).

## Пробный запуск в локальной сети или на localhost

Подходит, чтобы попробовать. Не для публикации в интернете.

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
```

Отредактируйте `.env`:

- `JWT_SECRET`: сгенерируйте командой `openssl rand -hex 32`.
- `POSTGRES_PASSWORD`: задайте надёжный пароль. С примерным `change-me`
  контейнер не запустится.
- `PUBLIC_ORIGIN=http://<host-ip>:3000` (или `http://localhost:3000`).
- Для пробного запуска по HTTP задайте `COOKIE_SECURE=false` (безопасное
  значение по умолчанию — `true`; по HTTP приложение откажется стартовать,
  чтобы не терять cookie молча).

```bash
docker compose up -d
```

Откройте `http://<host-ip>:3000/app/`. Так как это обычный HTTP, приложение
выводит громкое предупреждение о `COOKIE_SECURE=false`. Здесь это ожидаемо.

## Production с доменом и HTTPS

Отличие от пробного запуска в том, что вы перестаёте публиковать приложение
напрямую и позволяете прокси с завершением TLS пересылать запросы на
`localhost:3000`.

### Настройте `.env`

```
JWT_SECRET=<openssl rand -hex 32>
POSTGRES_USER=janosik
POSTGRES_PASSWORD=<strong password>
POSTGRES_DB=janosik
PUBLIC_ORIGIN=https://kanban.example.com
COOKIE_SECURE=true
TRUST_PROXY=1
ALLOW_REGISTRATION=true
```

`PUBLIC_ORIGIN` должен совпадать с URL, который реально открывают пользователи.
Он строит callback-URL для OAuth и управляет проверкой Secure-cookie.

### Запустите стек

```bash
docker compose up -d
```

Теперь приложение доступно на `localhost:3000`, только с самого хоста.

### Поставьте TLS впереди

**Caddy** автоматически получает сертификат Let's Encrypt:

```text
# /etc/caddy/Caddyfile
kanban.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**nginx** завершает TLS и проксирует всё на приложение. Реальное время
работает без дополнительной настройки, потому что API отправляет
`X-Accel-Buffering: no`, но явное отключение буферизации безвредно и делает
намерение понятным. Поднимите `client_max_body_size`: по умолчанию nginx
отклоняет тела больше 1 МБ, и вложения (до 25 МБ), импорт досок (5 МБ) и
большие команды (2 МБ) упали бы с `413`.

```nginx
server {
    listen 443 ssl;
    server_name kanban.example.com;

    # ssl_certificate     /etc/letsencrypt/live/kanban.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/kanban.example.com/privkey.pem;

    client_max_body_size 30m;         # attachments, imports, commands

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # realtime (SSE)
        proxy_read_timeout 3600s;     # keep long-lived streams open
    }
}
```

**Traefik** работает так же: пересылайте на `127.0.0.1:3000`, передавайте
`X-Forwarded-For` и `X-Forwarded-Proto` и задайте `TRUST_PROXY=1`, чтобы
ограничения частоты и журнал аудита видели реальный IP клиента, а не IP
прокси. Минимальная конфигурация через file provider:

```yaml
# traefik dynamic configuration (file provider)
http:
  routers:
    janosik:
      rule: "Host(`kanban.example.com`)"
      entryPoints: [websecure]
      service: janosik
      tls:
        certResolver: letsencrypt
  services:
    janosik:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3000"
```

### Брандмауэр

Открытыми должны быть только порты прокси (`80`, `443`). Порт приложения
`3000`, а также порты базы данных и Redis остаются внутренними.

## Первый запуск

1. **Создайте учётную запись.** Откройте `PUBLIC_ORIGIN/app/` и нажмите
   **Create account**. Первая учётная запись это обычный пользователь.
   Автоматического администратора нет.
2. **Закройте регистрацию.** Задайте `ALLOW_REGISTRATION=false` в `.env` и
   выполните `docker compose up -d`. Позже это можно переключить в панели
   мастера через **Feature flags → Open registration**. Экран входа после
   этого скрывает форму регистрации.
3. **Создайте мастера (администратора платформы).** Панель по `/admin`
   принадлежит учётной записи мастера, которая находится вне таблицы
   пользователей и может быть создана только через CLI. HTTP-эндпоинта для
   этого намеренно нет:

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
   # hidden password prompt (typed twice); the first master becomes OWNER
   docker compose exec app node backend/scripts/admin-cli.cjs list
   ```

   Войдите в панель мастера по `PUBLIC_ORIGIN/app/admin`.

   Смена пароля существующего мастера (также отзывает его сессии и снимает
   блокировку):

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs passwd --email me@example.com
   ```

CLI принимает три команды: `create`, `passwd` и `list`. Пароли длиной от 8 до
100 символов и никогда не передаются в командной строке. Интерактивный запуск
запрашивает пароль дважды скрытым вводом; неинтерактивный читает переменную
окружения `ADMIN_PASSWORD`.

## Почта (необязательно)

Из коробки приложение работает в режиме логирования. Почта не отправляется, а
коды подтверждения печатаются в `docker compose logs app`. Для установки на
одного пользователя этого достаточно.

Чтобы отправлять реальную почту, откройте панель мастера, перейдите в
**Email service**, выберите шаблон (Gmail, Yandex, Mail.ru, Brevo, SendGrid
или свой SMTP), вставьте учётные данные и включите доставку. Для Gmail,
Yandex и Mail.ru нужен пароль приложения при включённой двухэтапной
аутентификации, а не пароль от входа.

## Справочник переменных окружения

Каждая переменная проверяется при запуске в `backend/src/config/env.ts`.
Стек compose заполняет нужные из них из `.env`.

| Переменная | Значение по умолчанию | Примечания |
| --- | --- | --- |
| `NODE_ENV` | `development` | Одно из `development`, `test`, `production`. Образ задаёт `production`. |
| `PORT` | `3000` | HTTP-порт, который слушает API. Контейнер всегда слушает `3000`; compose публикует его. |
| `DATABASE_URL` | нет (обязательна) | Строка подключения к PostgreSQL для Prisma. Compose строит её из `POSTGRES_USER`, `POSTGRES_PASSWORD` и `POSTGRES_DB`. |
| `TEST_DATABASE_URL` | пусто | Используется вместо `DATABASE_URL`, когда `NODE_ENV=test`, чтобы e2e никогда не трогал базу разработки. |
| `JWT_SECRET` | нет (обязательна) | Подписывает access-токены. Не менее 32 символов. Генерируйте через `openssl rand -hex 32`. |
| `ACCESS_TOKEN_TTL` | `15m` | Время жизни access-токена, строка длительности vercel/ms. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Время жизни refresh-токена в днях. |
| `THROTTLE_LIMIT` | `300` | Глобальное ограничение API, запросов в минуту на субъекта: пользователя, API-ключ или IP для анонимных вызовов. |
| `TRUST_PROXY` | `0` | Число доверенных хопов обратного прокси. Задайте `1` за одним прокси. |
| `UPLOAD_DIR` | пусто | Корень блобов для вложений и аватаров. Пусто означает `backend/data/uploads`; относительное значение привязывается к пакету backend, а не к рабочему каталогу процесса. |
| `STATIC_DIR` | пусто | Каталог собранного интерфейса. Пусто означает только API. Образ задаёт `/app/public`. Встроенные скрипты отсюда разрешены хешами CSP, вычисленными при запуске, поэтому после пересборки интерфейса перезапустите API. |
| `SITE_DIR` | пусто | Каталог собранного маркетингового сайта, отдаваемый по `/`. Пусто означает, что он не отдаётся. Образ задаёт `/app/site`. |
| `UI_BASE` | `/` | Подпуть, по которому отдаётся приложение, используется для редиректов OAuth. Образ задаёт `/app/`. |
| `ALLOW_PUBLIC_SHARES` | `true` | Главный переключатель публичных ссылок для чтения. `false` заставляет весь контур общих досок отвечать `404`. |
| `ALLOW_REGISTRATION` | `true` | Открытая регистрация. Задайте `false`, когда ваша учётная запись создана. Пока значение `true`, контейнер выводит предупреждение при запуске. |
| `COOKIE_SECURE` | `true` (в compose) | Принудительно задаёт атрибут `Secure` у cookie. Держите `true` за HTTPS; для пробного HTTP-запуска задайте `false` (иначе приложение откажется стартовать). Пусто = авто: включено в production. Допустимые значения: пусто, `true`, `false`. |
| `PURGE_AFTER_DAYS` | `30` | Удаляет мягко удалённые строки старше стольких дней. Используется, когда в панели нет настройки хранения. |
| `AUDIT_RETENTION_DAYS` | `365` | Удаляет строки журнала аудита мастер-панели старше стольких дней (для подотчётности окно длиннее). |
| `SHARE_RATE_LIMIT` | `240` | Запросы к публичной общей доске в минуту, на токен. |
| `SHARE_OG_RATE_LIMIT` | `60` | Запросы OG-превью публичной общей доски в минуту, на токен. |
| `SMTP_HOST` | пусто | Хост SMTP. Если не задан, письма пишутся в журнал и никогда не отправляются. |
| `SMTP_PORT` | `587` | Порт SMTP. |
| `SMTP_SECURE` | `false` | Неявный TLS. Используйте `true` для порта 465. |
| `SMTP_USER` | пусто | Пользователь SMTP. |
| `SMTP_PASS` | пусто | Пароль SMTP. |
| `SMTP_FROM` | `Janosik <no-reply@janosik.local>` | Заголовок From для исходящей почты. |
| `REDIS_URL` | пусто | URL Redis для очередей BullMQ, рассылки realtime между узлами и общих счётчиков ограничения частоты и задержки входа. Пусто означает внутрипроцессную очередь и счётчики в каждом процессе. |
| `QUEUES_DASHBOARD` | `false` | Монтирует дашборд очередей Bull Board по `/admin/queues`. Только для владельца. |
| `SETTINGS_SECRET` | пусто | Шифрует учётные данные, сохранённые из панели мастера. При пустом значении выводится из `JWT_SECRET`. |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | Публичный базовый URL интерфейса. Строит callback-URL для OAuth. Compose по умолчанию задаёт `http://localhost:3000`. |

Compose также читает переменные, которые API не проверяет:

| Переменная | Значение по умолчанию | Примечания |
| --- | --- | --- |
| `POSTGRES_USER` | `janosik` в `.env.example` | Пользователь базы данных, создаётся при первом `up`. |
| `POSTGRES_PASSWORD` | `change-me` в `.env.example` (обязательна) | Пароль базы данных. Задайте надёжный: пока он равен `change-me`, контейнер не запускается. |
| `POSTGRES_DB` | `janosik` в `.env.example` | Имя базы данных. |
| `JANOSIK_TAG` | `latest` | Тег образа для запуска, например `v0.1.0`. |

OAuth-вход (Google и Yandex) настраивается в панели мастера, а не в `.env`.

## Установка Docker по операционным системам

Два способа запустить Janosik на своей машине:

| | Docker (рекомендуется) | Из исходников (разработка) |
| --- | --- | --- |
| Что это | Готовый контейнер: всё приложение плюс PostgreSQL и Redis | Дев-сервер Node, при желании с локальным API |
| Что нужно | Docker Desktop или Docker Engine | Node.js 22.17 или новее, npm |
| Для чего подходит | Реальное использование, self-hosting | Изменение кода |

### macOS

Установите Docker Desktop (Apple Silicon или Intel) или Colima для более
лёгкой установки только через CLI:

```bash
brew install --cask docker          # Docker Desktop
# or, no GUI:
brew install colima docker docker-compose && colima start
```

Запустите Docker Desktop один раз и дождитесь сообщения о работе. Затем:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # copy into JWT_SECRET in .env
# edit .env: JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN=http://localhost:3000
docker compose up -d
```

Откройте `http://localhost:3000/app/`, создайте учётную запись, затем создайте
мастера:

```bash
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

Публикуемый образ собран и для `arm64`, и для `amd64`, поэтому на Apple
Silicon он работает нативно. Локальная сборка `docker build` тоже работает:
`ffmpeg-static` и Prisma поставляют бинарники arm64.

### Windows 11

Docker в Windows работает через WSL2, поэтому удобнее всего делать всё в
оболочке Linux внутри WSL2. Нативный PowerShell тоже подходит.

Разовая настройка:

1. Установите WSL2 и дистрибутив (Ubuntu) из PowerShell с правами
   администратора:

   ```powershell
   wsl --install
   ```

   Перезагрузитесь, если будет предложено, затем задайте имя пользователя и
   пароль Linux.

2. Установите Docker Desktop для Windows и включите **Use the WSL 2 based
   engine**, а также **WSL integration** для вашего дистрибутива Ubuntu.
   Держите Docker Desktop запущенным.

Вариант A, в WSL2 (рекомендуется). Откройте Ubuntu и следуйте командам для
Linux. `curl` и `openssl` доступны:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # JWT_SECRET
docker compose up -d
```

Вариант B, в PowerShell. `curl` поставляется с Windows 11 как `curl.exe`, но
`openssl` отсутствует, поэтому сгенерируйте секрет так:

```powershell
mkdir janosik; cd janosik
curl.exe -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl.exe -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
# JWT_SECRET value (64 hex chars):
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
notepad .env                    # paste it into JWT_SECRET, set POSTGRES_PASSWORD
docker compose up -d
```

Откройте `http://localhost:3000/app/` в браузере и создайте мастера тем же
способом из любой оболочки:

```powershell
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

Советы: держите проект внутри файловой системы WSL (например, `~/janosik`), а
не в `/mnt/c/…`, потому что файловый ввод-вывод через границу Windows и Linux
медленный. Если `docker` не найден в WSL, включите интеграцию WSL для вашего
дистрибутива в Docker Desktop. Сохраняйте `.env` в кодировке UTF-8 без BOM и
с переводами строк LF; шаблон уже такой.

### Linux

Установите Docker Engine и плагин Compose. Официальный скрипт удобства самый
быстрый:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out and back in
```

Или используйте пакеты вашего дистрибутива (Debian и Ubuntu):

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Запустите стек (после повторного входа `sudo` не нужен):

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # JWT_SECRET
nano .env                       # JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN
docker compose up -d
```

Откройте `http://localhost:3000/app/`, создайте учётную запись и мастера:

```bash
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

Для публичного сервера добавьте TLS и задайте `COOKIE_SECURE=true` и
`TRUST_PROXY=1`. Откройте брандмауэр только для `80` и `443`
(`sudo ufw allow 80,443/tcp`).

### Из исходников, все платформы

После установки Node 22.17 или новее (репозиторий пинит **24** в `.nvmrc`) и
выполнения `npm install` в корне репозитория. Сначала настройте API — dev-compose
читает `POSTGRES_*` из `backend/.env`, поэтому файл должен существовать до
`docker compose up`:

```bash
# 1. настройка API
cp backend/.env.example backend/.env
#   задайте JWT_SECRET (openssl rand -hex 32; в PowerShell см. раздел Windows)

# 2. dev PostgreSQL (контейнер janosik-postgres на порту 5433)
docker compose -f backend/docker-compose.yml up -d

# 3. миграции, сборка и запуск API (порт 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. во втором терминале запустите UI (Vite проксирует /api на :3000)
npm run dev
```

Dev-UI **всегда в серверном режиме**: `npm run dev` показывает **экран входа** и
требует API выше — «демо-доски без логина» в dev нет. Зарегистрируйтесь на
`http://localhost:5173` (регистрация открыта по умолчанию), создайте мастера
командой `npm run admin:create -w backend -- --email me@example.com` и откройте
`/admin`.

**Маркетинговый сайт** — отдельный dev-сервер (`npm run dev:site`, порт 4321).
В dev приложение не отдаётся по `/app/` на сайте — этот путь принадлежит
self-host образу, — поэтому CTA сайта надо нацелить на UI-сервер:
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`.

**Исходящая почта по умолчанию выключена** (log-mode, если не заданы `SMTP_*`):
коды идут в лог сервера, письма не отправляются. См.
[Email service](/ru/docs/admin/settings/) и [Runbooks](/ru/docs/runbooks/).
Локальная песочница — Mailpit:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
# SMTP localhost:1025, веб-ящик http://localhost:8025
```

Чтобы собрать образ из рабочей копии вместо загрузки готового, раскомментируйте
`build: .` в `docker-compose.yml`.

## Раздельный деплой (приложение и сайт на разных хостах)

Self-host образ это **один origin** — сайт по `/`, приложение по `/app/`, —
поэтому настраивать нечего. Если **приложение** и **маркетинговый сайт/доки**
отдаются с *разных* хостов, свяжите две перекрёстные ссылки:

| Направление | Переменная | Где задаётся | Значение |
| --- | --- | --- | --- |
| Сайт → Приложение (CTA «Sign in» / «Create account») | `PUBLIC_APP_URL` | сборка **сайта** | origin приложения, напр. `https://app.example.com/` |
| Приложение → Сайт («Help → Documentation») | `VITE_SITE_URL` | сборка **UI** | origin сайта, со слешем на конце, напр. `https://example.com/` |

Ошибка в любой из них приводит к **404**: CTA открывает страницу «не найдено»
сайта, либо Help → Documentation открывает страницу «не найдено» приложения. Та
же пара нужна в dev, где приложение и сайт всегда два сервера (приложение
`:5173`, сайт `:4321`):

```bash
# dev-сервер UI — меню «Помощь» ведёт на dev-сайт Astro:
VITE_SITE_URL=http://localhost:4321/ npm run dev

# dev-сервер сайта — CTA «Sign in» / «Create account» ведут на UI:
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

## Расположение данных

| Данные | Где |
| --- | --- |
| База данных | Docker-том `janosik-pgdata` |
| Redis | Docker-том `janosik-redisdata` |
| Вложения и аватары | Docker-том `janosik-uploads` |
| Конфигурация | `.env` рядом с `docker-compose.yml` |

Резервное копирование, восстановление и обновление описаны в
[Операционных runbook-ах](/ru/docs/runbooks/). Сообщайте об уязвимостях приватно;
см. [Безопасность](/ru/docs/security/).
