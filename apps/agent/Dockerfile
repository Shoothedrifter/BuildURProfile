FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/agent /app/apps/agent
RUN pip install --no-cache-dir uv==0.11.12 && \
    uv sync --project /app/apps/agent --frozen --no-dev --no-editable && \
    mkdir -p /app/checkpoints && chown -R 10001:10001 /app/checkpoints && \
    rm -rf /root/.cache/uv
USER 10001:10001
ENV AGENT_HOST=0.0.0.0 AGENT_PORT=8788
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=3)" || exit 1
CMD ["/app/apps/agent/.venv/bin/buildurprofile-agent"]
