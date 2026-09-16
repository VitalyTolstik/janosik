#!/bin/sh
# Создаёт тестовую БД для e2e (файл монтируется в docker-entrypoint-initdb.d).
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE janosik_test;
EOSQL
