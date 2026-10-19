# Android nativo — fase posterior à aprovação da interface

O APK ainda não está implementado. A proposta técnica é Kotlin + Jetpack Compose + Room/SQLite + WorkManager.

## Regras não negociáveis

- Cadastro de pluviômetros, lançamento e histórico de chuva funcionam offline, sem aguardar servidor.
- Operações são gravadas transacionalmente no Room junto com uma fila local persistente (outbox).
- Cada item e cada operação têm UUID estável. Repetir o envio não cria duplicatas.
- Sincronizar /sync/push em segundo plano com WorkManager quando Android permitir e houver internet; não prometer execução imediata.
- Só retirar item da fila após resposta accepted. No caso conflict, apresentar divergência para resolução, sem apagar alteração local.
- Após o push, aplicar /sync/pull e cursor em uma única transação Room, incluindo exclusões e alterações de outros usuários.
- A primeira autenticação requer rede. Registros offline após primeira instalação não devem exigir login online, respeitando políticas de acesso local.
- Dados no app podem ser compartilhados entre usuários autorizados do banco central, mas nunca diretamente expor o PostgreSQL.
- Segredos do servidor nunca ficam no código do aplicativo. Sessão deve ser mantida no armazenamento seguro oferecido pelo Android.
