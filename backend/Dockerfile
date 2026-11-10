FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
ARG PLUV_BUILD_ID=dev
ENV PLUV_BUILD_ID=${PLUV_BUILD_ID}
COPY backend/app ./app
COPY backend/scripts ./scripts
COPY backend/schema.sql ./schema.sql
COPY web ./web
# Injeta a versao realmente empacotada no HTML (sem depender do cache do PWA).
RUN python -c "import os,pathlib; p=pathlib.Path('/app/web/index.html'); p.write_text(p.read_text().replace('__PLUV_BUILD_ID__',os.environ['PLUV_BUILD_ID']))"
RUN useradd --system --uid 10001 pluv
USER pluv
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
