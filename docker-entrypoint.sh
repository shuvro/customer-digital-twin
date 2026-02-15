#!/bin/sh
set -e

echo "Waiting for database..."
until nc -z db 5432 2>/dev/null; do
  sleep 1
done
echo "Database is ready."

echo "Running migrations..."
npx prisma migrate deploy

echo "Starting application..."
exec node dist/index.js
