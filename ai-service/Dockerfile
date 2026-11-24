FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Container-level health check (Render also uses GET /health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1
# NOTE (Render): the dashboard Start Command overrides this CMD — use
# `uvicorn app.main:app --host 0.0.0.0 --port $PORT` there (see
# docs/DEPLOYMENT.md). The fixed 8000 below is for local/docker-compose use.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
