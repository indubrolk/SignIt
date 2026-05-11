#!/usr/bin/env sh
set -e

python manage.py migrate --noinput
exec gunicorn lettersign.wsgi:application --bind 0.0.0.0:${PORT:-8000}
