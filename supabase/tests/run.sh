#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres 16 with a minimal Supabase shim
# (auth.uid(), roles, storage tables) and runs the behavioural security tests.
# Usage: PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
psql -q -c "drop database if exists vd_test" -c "create database vd_test"
psql -q -d vd_test -v ON_ERROR_STOP=1 -f "$here/supabase-shim.sql"
for f in "$here"/../migrations/*.sql; do psql -q -d vd_test -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true; done
psql -qAt -d vd_test -v ON_ERROR_STOP=1 -f "$here/behaviour.sql" | grep -E "ok|PASSED|ERROR" || true
