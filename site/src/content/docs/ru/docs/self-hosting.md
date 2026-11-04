---
title: Установка на своём сервере
description: Запуск Janosik одним контейнером вместе с PostgreSQL и Redis, от пробного запуска в локальной сети до production за HTTPS.
---

Образ для self-hosting обслуживает весь продукт на одном origin: API по
`/api/v1`, приложение (React SPA) по `/app/` и маркетинговый сайт по `/`.
Отдельный веб-сервер не нужен, а SSE и cookie работают на одном origin.

## Что запускает стек

`docker compose up -d` запускает три контейнера:

- **`app`** — сайт, приложение, API, панель мастера и фоновые задачи.
  Слушает порт `3000`. Образ — `ghcr.io/vitalytolstik/janosik`; версия
  задаётся через `JANOSIK_TAG`, по умолчанию это `latest`.
- **`postgres`** — база данных `postgres:16-alpine` для досок, пользователей,
  команд и журнала аудита.
- **`redis`** — сервис `redis:7-alpine` для фоновых задач, включая почту,
  транскодирование, обслуживание и экспорт.

На хост публикуется только порт приложения; `postgres` и `redis` остаются
внутренними. При запуске контейнер `app` применяет миграции базы данных, затем
запускает API.

Контейнер стартует от root только для того, чтобы передать том загрузок
непривилегированному пользователю `node` (тома, созданные старыми образами,
принадлежат root), а затем запускает миграции, API и ffmpeg от `node`. До
этого он проверяет две настройки: отказывается запускаться, пока
`POSTGRES_PASSWORD` равен значению `change-me` из примера, и выводит напоминание при
каждом запуске, пока `ALLOW_REGISTRATION=true`.

Образ задаёт `STATIC_DIR=/app/public`, `SITE_DIR=/app/site` и
`UI_BASE=/app/`. С этими значениями по умолчанию маркетинговый сайт находится
по `/`, а приложение по `/app/`, поэтому интерфейс доски доступен по
`PUBLIC_ORIGIN/app/`, а панель мастера по `PUBLIC_ORIGIN/app/admin`.

## Платформы и установка

Janosik открывается в браузере и требует работающего сервера. Используйте Docker
на Linux, macOS (Intel или Apple Silicon) либо Windows с Docker Desktop и WSL2.
Docker автоматически скачает подходящий Linux-образ `amd64` или `arm64`.
Архивы в GitHub Releases содержат исходный код; отдельных установщиков `.exe`
для Windows и `.dmg` для macOS пока нет.

Версия v0.1.1 проверена в WSL и в Linux CI на обеих архитектурах. Отдельной
проверки на физическом Mac пока не было. Установщик запускает приложение только
на этом компьютере; для доступа с других устройств см. инструкции для локальной
сети и HTTPS ниже.

## Требования

- Хост с Docker Engine 24 или новее и плагином Docker Compose v2.
- Свободный порт `3210` для установщика по умолчанию; примеры ручной настройки
  локальной сети используют порт `3000`. Для публичного сервера нужны порты
  `80` и `443` и обратный прокси.
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

Для пробного запуска на Linux, macOS или Windows с WSL2 установите Docker,
Compose, curl и OpenSSL, затем выполните:

```bash
curl -fsSLO https://raw.githubusercontent.com/VitalyTolstik/janosik/main/install.sh && bash install.sh
```

Откройте `http://localhost:3210/app/`. Установщик создаст `janosik/.env` и
`janosik/docker-compose.yml`, сгенерирует уникальные секреты и откроет
приложение только на localhost. Он использует последний стабильный релиз GitHub
и соответствующий образ; оба должны быть опубликованы. Чтобы изменить папку или
порт, задайте `JANOSIK_INSTALL_DIR` или `JANOSIK_INSTALL_PORT` при запуске
`bash install.sh`. Существующие файлы установщик не перезаписывает. Если запуск
завершился с ошибкой, устраните её и выполните `docker compose up -d` в папке
установки.

Для локальной сети или ручной настройки:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
```

Отредактируйте `.env`:

- `JWT_SECRET`: сгенерируйте командой `openssl rand -hex 32`.
- `POSTGRES_PASSWORD`: задайте надёжный пароль. С значением `change-me` из примера
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
APP_BIND_ADDRESS=127.0.0.1
ALLOW_REGISTRATION=true
```

`PUBLIC_ORIGIN` должен совпадать с URL, который реально открывают пользователи.
Значение используется для формирования URL обратного вызова OAuth и проверки Secure-cookie.
При переходе с пробной установки сохраните её секреты и `COMPOSE_PROJECT_NAME`.
Установщик задаёт `PORT=3210`: измените порт на `3000` для примеров ниже или
направьте прокси на `127.0.0.1:3210`.

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

**nginx** завершает TLS и проксирует всё на приложение. Обновления в реальном
времени работают без дополнительной настройки, потому что API отправляет
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
   **Create account**. Первая учётная запись — это обычный пользователь.
   Автоматического администратора нет.
2. **Закройте регистрацию.** Задайте `ALLOW_REGISTRATION=false` в `.env` и
   выполните `docker compose up -d`. Позже это можно переключить в панели
   мастера через **Feature flags → Open registration**. Экран входа после
   этого скрывает форму регистрации. Настройка, сохранённая в панели, важнее
   значения `.env`; проверьте `allowRegistration: false` по адресу
   `/api/v1/auth/config`.
3. **Создайте мастера (администратора платформы).** Панель по `/admin`
   принадлежит учётной записи мастера, которая хранится отдельно от обычных
   пользователей. Первого администратора создают через CLI; следующих владелец
   может создавать из панели:

   ```bash
   docker compose exec app node /app/backend/scripts/admin-cli.cjs create --email me@example.com
   # hidden password prompt (typed twice); the first master becomes OWNER
   docker compose exec app node /app/backend/scripts/admin-cli.cjs list
   ```

   Войдите в панель мастера по `PUBLIC_ORIGIN/app/admin`.

   Смена пароля существующего мастера (также отзывает его сессии и снимает
   блокировку):

   ```bash
   docker compose exec app node /app/backend/scripts/admin-cli.cjs passwd --email me@example.com
   ```

CLI принимает три команды: `create`, `passwd` и `list`. Длина пароля — от 8 до
100 символов. Пароль никогда не передаётся в командной строке. Интерактивный
запуск
запрашивает пароль дважды скрытым вводом; неинтерактивный читает переменную
окружения `ADMIN_PASSWORD`.

### Подключение MCP

Стек Compose уже предоставляет API для MCP. Создайте персональный ключ в
**Account → API keys**, затем настройте MCP-клиент на машине агента по
[инструкции MCP](/ru/docs/mcp/). Для локального запуска укажите
`JANOSIK_URL=http://localhost:3210` и `JANOSIK_APP_BASE=/app`. Для процесса MCP
нужны Node.js и доступ к этому адресу; на другой машине или в контейнере вместо
`localhost` используйте доступный HTTPS-адрес.

## Почта (необязательно)

Без SMTP почта не отправляется, а новые аккаунты подтверждаются автоматически.
В production-логе содержание сообщений и коды не записываются.

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
| `DB_CONNECTION_LIMIT` | `10` | Размер пула Prisma на процесс API. Произведение числа реплик и этого лимита должно быть меньше `POSTGRES_MAX_CONNECTIONS`. |
| `SLOW_QUERY_MS` | `200` | Запросы Prisma, выполняющиеся не менее указанного времени, логируются вместе с id запроса. `0` — выключено. |
| `NODE_OPTIONS` | `--max-old-space-size=1024` | Потолок кучи Node для процесса API. Ограничивает память, чтобы всплеск живых потоков вызывал GC, а не OOM-киллер контейнера. Увеличьте на сервере с большим объёмом памяти. |
| `SHARE_AGGREGATE_CACHE_MS` | `2000` | Окно кэша агрегата живой общей доски. Для часто открываемой ссылки данные доски пересобираются не чаще одного раза за этот интервал; сохранённая команда сбрасывает кэш по `seq` доски. `0` — выключено. |
| `ADMIN_METRICS_CACHE_MS` | `5000` | Окно кэша `/admin/metrics` в мастер-панели (сбрасывается при любом действии модерации). `0` — выключено. |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | `shared_buffers` встроенного контейнера Postgres. |
| `POSTGRES_WORK_MEM` | `8MB` | `work_mem` встроенного контейнера Postgres. |
| `POSTGRES_MAX_CONNECTIONS` | `100` | `max_connections` встроенного контейнера Postgres. |
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
| `JANOSIK_TAG` | `latest` | Тег образа для запуска, например `v0.1.1`. |

OAuth-вход (Google и Yandex) настраивается в панели мастера, а не в `.env`.

## Установка Docker по операционным системам

Два способа запустить Janosik на своей машине:

| | Docker (рекомендуется) | Из исходников (разработка) |
| --- | --- | --- |
| Что это | Готовый контейнер: всё приложение плюс PostgreSQL и Redis | Серверы разработки интерфейса и API с PostgreSQL |
| Что нужно | Docker Desktop или Docker Engine | Node.js 22.17 или новее, npm |
| Для чего подходит | Реальное использование, self-hosting | Изменение кода |

### macOS

Установите и запустите Docker Desktop (Intel или Apple Silicon) либо Colima
с Docker и Compose. В терминале выполните команду из раздела
[пробной установки](#пробный-запуск-в-локальной-сети-или-на-localhost).
Опубликованный образ поддерживает `amd64` и `arm64`.

### Windows 11

1. Установите WSL2 и дистрибутив Linux (например, Ubuntu): выполните
   `wsl --install` в PowerShell от администратора. При необходимости
   перезагрузите компьютер.
2. Установите и запустите Docker Desktop. Включите WSL2 engine и интеграцию
   с WSL для выбранного дистрибутива.
3. Откройте терминал Ubuntu, убедитесь, что установлены `curl` и `openssl`,
   и выполните команду из раздела
   [пробной установки](#пробный-запуск-в-локальной-сети-или-на-localhost).
   Держите папку установки внутри файловой системы WSL (например, `~/janosik`).

Установщик — Bash-скрипт; не запускайте его напрямую в PowerShell.

### Linux

Установите и запустите Docker Engine с плагином Compose v2. Убедитесь, что ваш
пользователь может запускать Docker, и установите `curl` и OpenSSL. Затем
выполните команду из раздела
[пробной установки](#пробный-запуск-в-локальной-сети-или-на-localhost).
Официальные инструкции для дистрибутивов — на
[docs.docker.com/engine/install](https://docs.docker.com/engine/install/).

### Из исходников, все платформы

Установите Node.js 22.17 или новее (в `.nvmrc` указана основная версия **24**) и
выполните `npm install` в корне репозитория. Затем настройте API — dev-compose
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
образ для самостоятельного размещенияу, — поэтому для кнопок входа и регистрации
на сайте нужно указать адрес сервера разработки интерфейса:
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`.

**Исходящая почта по умолчанию выключена** (режим записи в журнал, если не заданы `SMTP_*`):
письма не отправляются, а коды в production-лог не записываются. См.
[Почтовая служба](/ru/docs/admin/settings/) и [Инструкции по эксплуатации](/ru/docs/runbooks/).
Локальная песочница — Mailpit:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
# SMTP localhost:1025, веб-ящик http://localhost:8025
```

Чтобы собрать образ из рабочей копии вместо загрузки готового, раскомментируйте
`build: .` в `docker-compose.yml`.

## Раздельный деплой (приложение и сайт на разных хостах)

Образ для самостоятельного размещения обслуживает сайт и приложение по **одному
базовому адресу** — сайт по `/`, приложение по `/app/`, —
поэтому настраивать нечего. Если **приложение** и **маркетинговый сайт/доки**
отдаются с *разных* хостов, настройте ссылки между сайтом и приложением:

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
[инструкциях по эксплуатации](/ru/docs/runbooks/). Сообщайте об уязвимостях приватно;
см. [Безопасность](/ru/docs/security/).
