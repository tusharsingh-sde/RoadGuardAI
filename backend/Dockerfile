FROM python:3.12-slim

WORKDIR /app

# Single clean layer for OpenCV system deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first for better Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source and model weights
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5)" || exit 1

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:8000 -w ${WEB_CONCURRENCY:-1} -k uvicorn.workers.UvicornWorker --timeout 600 --graceful-timeout 30 main:app"]
