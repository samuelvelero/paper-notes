# buscador: índice FTS5 + vectores. Es la única pieza del proyecto con
# dependencias (fastembed trae onnxruntime y tokenizers; sqlite-vec el
# índice vectorial). El modelo se descarga la primera vez a /data/models
# (volumen), así que no se vuelve a bajar al reconstruir la imagen.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

EXPOSE 8095
CMD ["python", "app.py"]
