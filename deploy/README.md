# Implantação da API na VPS

O PostgreSQL 17 já está rodando no contêiner pluviometros-db-1, banco pluv_db e volume persistente. Este repositório NÃO deve recriar o banco.

### Sequência segura

1. Conectar o repositório privado à VPS usando uma chave de deploy do GitHub com acesso somente de leitura. Não copiar senhas de GitHub para terminais, mensagens ou scripts.
2. Clonar o repositório em /opt/apps/pluviometros/source.
3. Aplicar backend/schema.sql dentro de pluv_db, usando o administrador PostgreSQL já criado.
4. Criar usuário de banco pluv_api SEM privilégios de superusuário, com senha exclusiva; conceder CONNECT, USAGE e operações DML somente às tabelas pluv_* e USAGE à sequência de pluv_changes.
5. Criar /opt/apps/pluviometros/config/api.env com permissão 600 e DATABASE_URL do usuário pluv_api.
6. Executar backend/scripts/bootstrap_admin.py com DATABASE_URL e uma senha digitada no terminal privado.
7. Na pasta do repositório clonado, iniciar com docker compose -f deploy/compose.api.yaml up -d --build.
8. Testar pela VPS: curl http://127.0.0.1:8001/health
9. Configurar HTTPS e proxy reverso, limites no endpoint de login, backups externos e monitoramento antes de abrir a API para usuários.

### Avisos importantes

- Nunca rode docker compose down -v no PostgreSQL nem apague o volume pluviometros_pluv_data.
- A porta PostgreSQL 5432 NÃO deve ser publicada na internet.
- A porta HTTP 8001 do host é vinculada só a 127.0.0.1: não deve ser aberta no UFW.
- O Docker pode ignorar parte das regras do UFW em portas publicadas; confirme explicitamente qualquer publicação futura.
- Os dados de usuário, sessão, pluviômetros, medições e alterações ficam no mesmo banco central PLUV.
- A API aceita UUID por aparelho e operações idempotentes em /sync/push. Um retorno conflict requer resolução no cliente, sem descartar o dado offline.
- O endpoint /sync/pull usa cursor incremental, mantido e atualizado no dispositivo após gravar os dados.
- Ainda faltam testes de carga, backups testados, acesso HTTPS público e aplicativo Android nativo. NÃO exponha a API sem completar as proteções.

### Rotas principais

POST /auth/login — autenticação
POST /auth/logout — encerra sessão
GET /auth/me — usuário autenticado
POST /admin/users — cadastro restrito a administradores
POST /sync/push — até 100 alterações com identificadores únicos
GET /sync/pull?after=0&limit=200 — mudanças compartilhadas com cursor
GET /health — teste interno do banco
