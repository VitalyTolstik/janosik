#!/bin/sh
# Creates the e2e test database (mounted into docker-entrypoint-initdb.d).
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE janosik_test;
EOSQL
