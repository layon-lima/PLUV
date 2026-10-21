-- Atualizacao aditiva, preserva todos os registros existentes do PLUV.
-- Tabelas de usuarios/sessoes antigas continuam intocadas, embora o PWA nao use login.
CREATE TABLE IF NOT EXISTS pluv_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username varchar(120) UNIQUE NOT NULL,
 password_hash text NOT NULL, role varchar(12) NOT NULL CHECK (role IN ('admin','editor','reader')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pluv_sessions (
 token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES pluv_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pluv_sessions_user_idx ON pluv_sessions(user_id);
CREATE TABLE IF NOT EXISTS pluv_gauges (
 id uuid PRIMARY KEY, name varchar(160) NOT NULL, location varchar(240) NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '', version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS pluv_readings (
 id uuid PRIMARY KEY, gauge_id uuid NOT NULL REFERENCES pluv_gauges(id),
 amount_mm numeric(10,2) NOT NULL CHECK (amount_mm>=0 AND amount_mm<=10000),
 observed_at timestamptz NOT NULL, notes text NOT NULL DEFAULT '',
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
-- GPS opcional da medicao: nunca exige coordenadas para registrar chuva.
-- Atualizacao aditiva que preserva todos os lancamentos existentes.
ALTER TABLE pluv_readings ADD COLUMN IF NOT EXISTS latitude numeric(9,6);
ALTER TABLE pluv_readings ADD COLUMN IF NOT EXISTS longitude numeric(9,6);
ALTER TABLE pluv_readings ADD COLUMN IF NOT EXISTS location_accuracy_m numeric(12,2);
CREATE INDEX IF NOT EXISTS pluv_readings_gauge_idx ON pluv_readings(gauge_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS pluv_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind varchar(12) NOT NULL CHECK (kind IN ('gauge','reading')),
 entity_id uuid NOT NULL, action varchar(10) NOT NULL CHECK (action IN ('upsert','delete')),
 version bigint NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pluv_operations (
 op_id uuid PRIMARY KEY,
 user_id uuid REFERENCES pluv_users(id),
 kind varchar(12) NOT NULL, entity_id uuid NOT NULL, version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Migra registros da versao anterior: nao exclui usuarios nem dados existentes.
ALTER TABLE pluv_operations ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS pluv_changes_kind_idx ON pluv_changes(kind,id);
