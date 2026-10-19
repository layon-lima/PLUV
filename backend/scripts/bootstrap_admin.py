"""Cria o primeiro usuario administrador. Execute apenas em terminal seguro."""
import getpass
import os
import sys

import psycopg
from argon2 import PasswordHasher

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    sys.exit("DATABASE_URL ausente")

username = input("Nome do administrador: ").strip().lower()
if len(username) < 3 or len(username) > 120:
    sys.exit("Nome de usuario deve ter entre 3 e 120 caracteres")
password = getpass.getpass("Senha (minimo 12 caracteres): ")
if len(password) < 12:
    sys.exit("Senha muito curta")
with psycopg.connect(database_url) as conn:
    existing = conn.execute("SELECT 1 FROM pluv_users WHERE username=%s", (username,)).fetchone()
    if existing:
        sys.exit("Usuario ja existe; nenhuma alteracao realizada")
    conn.execute(
        "INSERT INTO pluv_users(username,password_hash,role) VALUES(%s,%s,'admin')",
        (username, PasswordHasher().hash(password)),
    )
print("Administrador criado com sucesso")
