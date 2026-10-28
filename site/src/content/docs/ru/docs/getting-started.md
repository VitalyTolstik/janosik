---
title: С чего начать
description: Что такое Janosik, как он работает и самый быстрый путь к рабочей доске.
---

Janosik это канбан-приложение для планирования работы на колонках с
карточками. Оно устанавливается как PWA и работает в **серверном режиме**: доски живут
за учётной записью, в PostgreSQL, их отдаёт API на NestJS.

Логика доски спроектирована offline-first, но **собранные сборки всегда ходят в
API** — `npm run dev` и `npm run build` показывают **экран входа**, а не
демо-доску без логина. Единственный режим без бэкенда («локальный») — это тот,
что прогоняют **unit-тесты**: редьюсер поверх `localStorage` с засеянной
демо-доской.

Self-host образ отдаёт доки на том же источнике, что и приложение. При
раздельном деплое (приложение и сайт на разных хостах) две перекрёстные ссылки
связываются вручную: `VITE_SITE_URL` (сборка UI) направляет **Help →
Documentation** на сайт, а `PUBLIC_APP_URL` (сборка сайта) направляет **Sign
in** / **Create account** на приложение — см.
[Раздельный деплой](/ru/docs/self-hosting/). В dev это два сервера (приложение
`:5173`, сайт `:4321`), так что задавайте обе.

## Самый быстрый путь: образ для self-hosting

Один контейнер обслуживает всё приложение (API по `/api/v1`, собранное SPA и
маркетинговый сайт) рядом с PostgreSQL и Redis.
[Self-hosting](/ru/docs/self-hosting/) содержит полное руководство; короткая версия:

```bash
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
# отредактируйте .env: задайте JWT_SECRET (openssl rand -hex 32) и PUBLIC_ORIGIN
docker compose up -d
```

Миграции выполняются при запуске. Откройте приложение, создайте учётную
запись, затем закройте регистрацию. [Self-hosting](/ru/docs/self-hosting/) описывает
первый запуск по шагам.

## Из исходников (разработка)

Требования: Node.js 22.17 или новее — репозиторий пинит **24** в `.nvmrc`
(`nvm install && nvm use`).

Сначала настройте API, потом поднимайте базу: dev-compose читает `POSTGRES_*`
из `backend/.env`, поэтому файл должен существовать до `docker compose up`.

```bash
cp backend/.env.example backend/.env                 # задайте JWT_SECRET
docker compose -f backend/docker-compose.yml up -d   # PostgreSQL на :5433
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend                             # API на :3000
npm run dev                                          # UI на :5173 (проксирует /api → :3000)
```

Зарегистрируйтесь на `http://localhost:5173` (регистрация открыта по умолчанию)
и создайте первого мастера командой
`npm run admin:create -w backend -- --email me@example.com` для панели
`/admin`. Все шаги из исходников для каждой платформы — в
[Self-hosting](/ru/docs/self-hosting/).

### Маркетинговый сайт (Astro) в dev

Сайт и доки идут отдельным dev-сервером (`npm run dev:site`, порт 4321). В dev
приложение **не** отдаётся по `/app/` на сайте — этот путь принадлежит
self-host образу, где один сервер отдаёт сайт по `/`, а приложение по `/app/`.
Поэтому CTA «Sign in» / «Create account» на сайте надо нацелить на UI-сервер,
иначе они дают 404:

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

### Исходящая почта по умолчанию выключена

Без настроенного SMTP API работает в **log-mode**: коды подтверждения и
уведомления пишутся в лог сервера, а не отправляются, и регистрация
само-верифицируется — ничего не отправляется, пока вы не настроите транспорт
(см. [Email service](/ru/docs/admin/settings/) и
[Runbooks](/ru/docs/runbooks/)). Для локальной песочницы:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
# SMTP localhost:1025, веб-ящик http://localhost:8025
```

## Куда идти дальше

- [Self-hosting](/ru/docs/self-hosting/) устанавливает сервер и базу данных, описывает
  TLS, инструкции по Docker для каждой ОС и справочник переменных окружения.
- [Операционные runbook-и](/ru/docs/runbooks/) описывают резервное копирование,
  восстановление, обновление, мониторинг и устранение неполадок.
- [Руководство пользователя](/ru/docs/user-guide/) проводит по интерфейсу.
- [Справочник API](/ru/docs/api/) описывает HTTP API для скриптов и агентов.
- [FAQ и устранение неполадок](/ru/docs/faq/) отвечает на частые вопросы.
