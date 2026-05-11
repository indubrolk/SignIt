# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo libfreetype6 liblcms2-2 libwebp7 zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.txt

COPY . /app/

RUN chmod +x /app/start.sh \
    && mkdir -p /app/media \
    && python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["/app/start.sh"]
