"""PLUV PWA — API de sincronizacao SEM LOGIN, compartilhada pela fazenda.
ATENCAO: endpoints /sync sao publicos. Qualquer pessoa que saiba a URL pode ler/alterar dados.
"""
import os
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import AwareDatetime, BaseModel, Field
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise RuntimeError('DATABASE_URL nao configurada')
pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False,
                      kwargs={'row_factory': dict_row})

@asynccontextmanager
async def lifespan(_app: FastAPI):
    pool.open()
    pool.wait(timeout=15)
    yield
    pool.close()

app = FastAPI(title='PLUV API', version='1.0.0', lifespan=lifespan)
# A origem local pode testar contra a VPS sem login e sem extensoes do navegador.
# Para o app em producao, web e API sao servidos sob a mesma origem HTTPS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://127.0.0.1:8765', 'http://localhost:8765'],
    allow_credentials=False,
    allow_methods=['GET', 'POST'],
    allow_headers=['Content-Type'],
)

class GaugeData(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    location: str = Field(default='', max_length=240)
    description: str = Field(default='', max_length=2000)

class ReadingData(BaseModel):
    gauge_id: UUID
    amount_mm: Decimal = Field(ge=0, le=10000, max_digits=10, decimal_places=2)
    observed_at: AwareDatetime
    notes: str = Field(default='', max_length=2000)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90, max_digits=9, decimal_places=6)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180, max_digits=9, decimal_places=6)
    location_accuracy_m: Decimal | None = Field(default=None, ge=0, le=999999, max_digits=12, decimal_places=2)

class Operation(BaseModel):
    op_id: UUID
    kind: Literal['gauge', 'reading']
    entity_id: UUID
    action: Literal['upsert', 'delete']
    base_version: int = Field(ge=0)
    data: dict[str, Any] = Field(default_factory=dict)

class PushRequest(BaseModel):
    operations: list[Operation] = Field(min_length=1, max_length=50)

@app.get('/health')
def health():
    with pool.connection() as conn:
        conn.execute('SELECT 1').fetchone()
    return {'status': 'ok'}

def payload_for(kind: str, row: dict) -> dict:
    fields = ('id', 'name', 'location', 'description', 'version', 'updated_at', 'deleted_at') if kind == 'gauge' else (
        'id', 'gauge_id', 'amount_mm', 'observed_at', 'notes', 'latitude', 'longitude', 'location_accuracy_m', 'version', 'updated_at', 'deleted_at')
    result = {}
    for key in fields:
        value = row[key]
        if isinstance(value, (UUID, Decimal)):
            value = str(value)
        elif isinstance(value, datetime):
            value = value.isoformat()
        result[key] = value
    return result

def process_operation(op: Operation) -> dict:
    # Validate before transaction. All writes serialize their commit/cursor order.
    data = None
    if op.action == 'upsert':
        data = GaugeData.model_validate(op.data) if op.kind == 'gauge' else ReadingData.model_validate(op.data)
    table = 'pluv_gauges' if op.kind == 'gauge' else 'pluv_readings'
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute('SELECT pg_advisory_xact_lock(739124)')
            previous = conn.execute('SELECT kind,entity_id,version FROM pluv_operations WHERE op_id=%s', (op.op_id,)).fetchone()
            if previous:
                if previous['kind'] != op.kind or previous['entity_id'] != op.entity_id:
                    return {'op_id': str(op.op_id), 'status': 'conflict', 'reason': 'operation_id_reused'}
                return {'op_id': str(op.op_id), 'status': 'accepted', 'version': previous['version'], 'duplicate': True}
            current = conn.execute('SELECT * FROM ' + table + ' WHERE id=%s FOR UPDATE', (op.entity_id,)).fetchone()
            if current is None and (op.action == 'delete' or op.base_version != 0):
                return {'op_id': str(op.op_id), 'status': 'conflict', 'reason': 'not_found'}
            if current is not None and op.base_version != current['version']:
                return {'op_id': str(op.op_id), 'status': 'conflict', 'reason': 'stale_version', 'server': payload_for(op.kind, current)}
            if current is not None and current['deleted_at'] is not None and op.action == 'upsert':
                return {'op_id': str(op.op_id), 'status': 'conflict', 'reason': 'deleted', 'server': payload_for(op.kind, current)}
            version = 1 if current is None else current['version'] + 1
            if op.kind == 'gauge':
                if op.action == 'upsert' and current is None:
                    row = conn.execute('INSERT INTO pluv_gauges(id,name,location,description) VALUES(%s,%s,%s,%s) RETURNING *',
                                       (op.entity_id, data.name, data.location, data.description)).fetchone()
                elif op.action == 'upsert':
                    row = conn.execute('UPDATE pluv_gauges SET name=%s,location=%s,description=%s,version=%s,updated_at=now() WHERE id=%s RETURNING *',
                                       (data.name, data.location, data.description, version, op.entity_id)).fetchone()
                else:
                    row = conn.execute('UPDATE pluv_gauges SET deleted_at=now(),version=%s,updated_at=now() WHERE id=%s RETURNING *',
                                       (version, op.entity_id)).fetchone()
            else:
                if op.action == 'upsert':
                    gauge = conn.execute('SELECT deleted_at FROM pluv_gauges WHERE id=%s', (data.gauge_id,)).fetchone()
                    if gauge is None or gauge['deleted_at'] is not None:
                        return {'op_id': str(op.op_id), 'status': 'conflict', 'reason': 'gauge_missing'}
                if op.action == 'upsert' and current is None:
                    row = conn.execute('INSERT INTO pluv_readings(id,gauge_id,amount_mm,observed_at,notes,latitude,longitude,location_accuracy_m) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',
                                       (op.entity_id, data.gauge_id, data.amount_mm, data.observed_at, data.notes, data.latitude, data.longitude, data.location_accuracy_m)).fetchone()
                elif op.action == 'upsert':
                    row = conn.execute('UPDATE pluv_readings SET gauge_id=%s,amount_mm=%s,observed_at=%s,notes=%s,latitude=COALESCE(%s,latitude),longitude=COALESCE(%s,longitude),location_accuracy_m=COALESCE(%s,location_accuracy_m),version=%s,updated_at=now() WHERE id=%s RETURNING *',
                                       (data.gauge_id, data.amount_mm, data.observed_at, data.notes, data.latitude, data.longitude, data.location_accuracy_m, version, op.entity_id)).fetchone()
                else:
                    row = conn.execute('UPDATE pluv_readings SET deleted_at=now(),version=%s,updated_at=now() WHERE id=%s RETURNING *',
                                       (version, op.entity_id)).fetchone()
            snapshot = payload_for(op.kind, row)
            conn.execute('INSERT INTO pluv_changes(kind,entity_id,action,version,payload) VALUES(%s,%s,%s,%s,%s)',
                         (op.kind, op.entity_id, op.action, version, Jsonb(snapshot)))
            # Legacy column user_id is nullable after additive migration; no user is required.
            conn.execute('INSERT INTO pluv_operations(op_id,kind,entity_id,version) VALUES(%s,%s,%s,%s)',
                         (op.op_id, op.kind, op.entity_id, version))
            return {'op_id': str(op.op_id), 'status': 'accepted', 'version': version, 'duplicate': False}

@app.post('/sync/push')
def sync_push(request: PushRequest):
    return {'results': [process_operation(op) for op in request.operations]}

@app.get('/sync/pull')
def sync_pull(after: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=500)):
    with pool.connection() as conn:
        rows = conn.execute('SELECT id,kind,entity_id,action,version,payload,created_at FROM pluv_changes WHERE id>%s ORDER BY id LIMIT %s',
                            (after, limit + 1)).fetchall()
    more = len(rows) > limit
    selected = rows[:limit]
    return {'changes': [
        {'cursor': r['id'], 'kind': r['kind'], 'entity_id': str(r['entity_id']),
         'action': r['action'], 'version': r['version'], 'data': r['payload'],
         'created_at': r['created_at'].isoformat()}
        for r in selected], 'next_cursor': selected[-1]['id'] if selected else after, 'has_more': more}

# O mesmo servidor HTTPS distribui PWA e API; evita CORS e dupla infraestrutura.
WEB_DIR = Path(__file__).resolve().parent.parent / 'web'
if WEB_DIR.is_dir():
    app.mount('/', StaticFiles(directory=str(WEB_DIR), html=True), name='pluv-web')
