FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    TZ_NAME=Europe/London

# iptables: egress firewall inside the container's own network namespace (see entrypoint.sh)
RUN apt-get update \
 && apt-get install -y --no-install-recommends iptables \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=755 egress-check.sh /usr/local/bin/egress-check

# All persistent data (SQLite database, session key, backups) lives here.
# Mount a host folder on it. The entrypoint drops to PUID:PGID (default 99:100, Unraid's nobody:users).
ENV PUID=99 PGID=100 UMASK=002 \
    EGRESS_FIREWALL=on \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=8000 \
    FORWARDED_ALLOW_IPS=*
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# Host/port/trusted proxies come from UVICORN_HOST, UVICORN_PORT and FORWARDED_ALLOW_IPS.
CMD ["uvicorn", "app.main:app", "--proxy-headers"]
