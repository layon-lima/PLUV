"""PLUV API: autenticacao e sincronizacao segura de dispositivos offline."""
import hashlib
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field, field_validator
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL nao configurada")

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False, kwargs={"row_factory": dict_row})
hasher = PasswordHasher()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    pool.open()
    pool.wait(timeout=15)
    yield
    pool.close()


app = FastAPI(title="PLUV API", version="0.1.0", lifespan=lifespan)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=256)


class NewUser(Credentials):
    role: Literal["admin", "editor", "reader"] = "editor"


class GaugeData(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=240)
    description: str = Field(default="", max_length=2000)


class ReadingData(BaseModel):
    gauge_id: UUID
    amount_mm: Decimal = Field(ge=0, le=10000, max_digits=10, decimal_places=2)
    observed_at: AwareDatetime
    notes: str = Field(default="", max_length=2000)


class Operation(BaseModel):
    op_id: UUID
    kind: Literal["gauge", "reading"]
    entity_id: UUID
    action: Literal["upsert", "delete"]
    base_version: int | None = Field(default=None, ge=0)
    data: dict[str, Any] = Field(default_factory=dict)


class PushRequest(BaseModel):
    operations: list[Operation] = Field(min_length=1, max_length=100)


def actor(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")
    token = authorization.removeprefix("Bearer ").strip()
    if len(token) != 64:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalido")
    digest = hashlib.sha256(token.encode()).hexdigest()
    with pool.connection() as conn:
        row = conn.execute(
            """SELECT u.id, u.username, u.role
               FROM pluv_sessions s JOIN pluv_users u ON u.id=s.user_id
               WHERE s.token_hash=%s AND s.expires_at>now() AND u.active=true""",
            (digest,),
        ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessao expirada ou invalida")
    return row


def require_write(user: Annotated[dict, Depends(actor)]) -> dict:
    if user["role"] not in ("admin", "editor"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissao de escrita")
    return user


def require_admin(user: Annotated[dict, Depends(actor)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Exige administrador")
    return user


@app.get("/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1").fetchone()
    return {"status": "ok"}


@app.post("/auth/login")
def login(credentials: Credentials):
    username = credentials.username.strip().lower()
    with pool.connection() as conn:
        user = conn.execute(
            "SELECT id, password_hash, role, active FROM pluv_users WHERE username=%s", (username,)
        ).fetchone()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais incorretas")
    try:
        valid = hasher.verify(user["password_hash"], credentials.password)
    except (VerifyMismatchError, VerificationError):
        valid = False
    if not valid or not user["active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais incorretas")
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = datetime.now(timezone.utc) + timedelta(days=30)
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO pluv_sessions(token_hash,user_id,expires_at) VALUES(%s,%s,%s)",
            (token_hash, user["id"], expires),
        )
    return {"access_token": token, "token_type": "bearer", "expires_at": expires.isoformat(), "role": user["role"]}


@app.get("/auth/me")
def me(user: Annotated[dict, Depends(actor)]):
    return {"id": str(user["id"]), "username": user["username"], "role": user["role"]}


@app.post("/auth/logout")
def logout(user: Annotated[dict, Depends(actor)], authorization: Annotated[str, Header()]):
    digest = hashlib.sha256(authorization.removeprefix("Bearer ").strip().encode()).hexdigest()
    with pool.connection() as conn:
        conn.execute("DELETE FROM pluv_sessions WHERE token_hash=%s AND user_id=%s", (digest, user["id"]))
    return {"ok": True}


@app.post("/admin/users", status_code=201)
def create_user(data: NewUser, _admin: Annotated[dict, Depends(require_admin)]):
    username = data.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(422, "Usuario muito curto")
    hashed = hasher.hash(data.password)
    with pool.connection() as conn:
        existing = conn.execute("SELECT 1 FROM pluv_users WHERE username=%s", (username,)).fetchone()
        if existing:
            raise HTTPException(409, "Usuario ja existe")
        row = conn.execute(
            "INSERT INTO pluv_users(username,password_hash,role) VALUES(%s,%s,%s) RETURNING id",
            (username, hashed, data.role),
        ).fetchone()
    return {"id": str(row["id"]), "username": username, "role": data.role}


def payload_for(kind: str, row: dict) -> dict:
    if kind == "gauge":
        fields = ("id", "name", "location", "description", "version", "updated_at", "deleted_at")
    else:
        fields = ("id", "gauge_id", "amount_mm", "observed_at", "notes", "version", "updated_at", "deleted_at")
    result = {}
    for key in fields:
        value = row[key]
        if isinstance(value, (UUID, Decimal)):
            value = str(value)
        elif isinstance(value, datetime):
            value = value.isoformat()
        result[key] = value
    return result


def process_operation(user: dict, op: Operation) -> dict:
    # Valida dados antes de iniciar a transacao; evita aceitar campos inesperados.
    data = None
    if op.action == "upsert":
        data = GaugeData.model_validate(op.data) if op.kind == "gauge" else ReadingData.model_validate(op.data)
    table = "pluv_gauges" if op.kind == "gauge" else "pluv_readings"
    with pool.connection() as conn:
        with conn.transaction():
            # Serializa escritas para que o cursor de mudancas nao perca commits tardios.
            conn.execute("SELECT pg_advisory_xact_lock(739124)")
            previous = conn.execute(
                "SELECT user_id, kind, entity_id, version FROM pluv_operations WHERE op_id=%s",
                (op.op_id,),
            ).fetchone()
            if previous:
                if previous["user_id"] != user["id"] or previous["kind"] != op.kind or previous["entity_id"] != op.entity_id:
                    return {"op_id": str(op.op_id), "status": "conflict", "reason": "operation_id_reused"}
                return {"op_id": str(op.op_id), "status": "accepted", "version": previous["version"], "duplicate": True}
            current = conn.execute("SELECT * FROM " + table + " WHERE id=%s FOR UPDATE", (op.entity_id,)).fetchone()
            if current is None and (op.action == "delete" or op.base_version not in (None, 0)):
                return {"op_id": str(op.op_id), "status": "conflict", "reason": "not_found"}
            if current is not None and op.base_version != current["version"]:
                return {
                    "op_id": str(op.op_id), "status": "conflict", "reason": "stale_version",
                    "server": payload_for(op.kind, current),
                }
            if current is not None and current["deleted_at"] is not None and op.action == "upsert":
                return {"op_id": str(op.op_id), "status": "conflict", "reason": "deleted", "server": payload_for(op.kind, current)}
            version = 1 if current is None else current["version"] + 1
            if op.kind == "gauge":
                if op.action == "upsert" and current is None:
                    row = conn.execute(
                        "INSERT INTO pluv_gauges(id,name,location,description) VALUES(%s,%s,%s,%s) RETURNING *",
                        (op.entity_id, data.name, data.location, data.description),
                    ).fetchone()
                elif op.action == "upsert":
                    row = conn.execute(
                        """UPDATE pluv_gauges SET name=%s,location=%s,description=%s,
                           version=%s,updated_at=now() WHERE id=%s RETURNING *""",
                        (data.name, data.location, data.description, version, op.entity_id),
                    ).fetchone()
                else:
                    row = conn.execute(
                        "UPDATE pluv_gauges SET deleted_at=now(),version=%s,updated_at=now() WHERE id=%s RETURNING *",
                        (version, op.entity_id),
                    ).fetchone()
            else:
                if op.action == "upsert":
                    gauge = conn.execute("SELECT deleted_at FROM pluv_gauges WHERE id=%s", (data.gauge_id,)).fetchone()
                    if gauge is None or gauge["deleted_at"] is not None:
                        return {"op_id": str(op.op_id), "status": "conflict", "reason": "gauge_missing"}
                if op.action == "upsert" and current is None:
                    row = conn.execute(
                        """INSERT INTO pluv_readings(id,gauge_id,amount_mm,observed_at,notes)
                           VALUES(%s,%s,%s,%s,%s) RETURNING *""",
                        (op.entity_id, data.gauge_id, data.amount_mm, data.observed_at, data.notes),
                    ).fetchone()
                elif op.action == "upsert":
                    row = conn.execute(
                        """UPDATE pluv_readings SET gauge_id=%s,amount_mm=%s,observed_at=%s,
                           notes=%s,version=%s,updated_at=now() WHERE id=%s RETURNING *""",
                        (data.gauge_id, data.amount_mm, data.observed_at, data.notes, version, op.entity_id),
                    ).fetchone()
                else:
                    row = conn.execute(
                        "UPDATE pluv_readings SET deleted_at=now(),version=%s,updated_at=now() WHERE id=%s RETURNING *",
                        (version, op.entity_id),
                    ).fetchone()
            snapshot = payload_for(op.kind, row)
            conn.execute(
                "INSERT INTO pluv_changes(kind,entity_id,action,version,payload) VALUES(%s,%s,%s,%s,%s)",
                (op.kind, op.entity_id, op.action, version, Jsonb(snapshot)),
            )
            conn.execute(
                "INSERT INTO pluv_operations(op_id,user_id,kind,entity_id,version) VALUES(%s,%s,%s,%s,%s)",
                (op.op_id, user["id"], op.kind, op.entity_id, version),
            )
            return {"op_id": str(op.op_id), "status": "accepted", "version": version, "duplicate": False}


@app.post("/sync/push")
def sync_push(request: PushRequest, user: Annotated[dict, Depends(require_write)]):
    return {"results": [process_operation(user, op) for op in request.operations]}


@app.get("/sync/pull")
def sync_pull(user: Annotated[dict, Depends(actor)], after: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=500)):
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT id,kind,entity_id,action,version,payload,created_at
               FROM pluv_changes WHERE id>%s ORDER BY id LIMIT %s""",
            (after, limit + 1),
        ).fetchall()
    has_more = len(rows) > limit
    selected = rows[:limit]
    return {
        "changes": [
            {
                "cursor": r["id"], "kind": r["kind"], "entity_id": str(r["entity_id"]),
                "action": r["action"], "version": r["version"], "data": r["payload"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in selected
        ],
        "next_cursor": selected[-1]["id"] if selected else after,
        "has_more": has_more,
    }
