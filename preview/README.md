# Testar a interface do PLUV (sem APK)

Abra `index.html` no navegador do PC ou do Android. Para baixar pelo GitHub: abra `preview/index.html`, clique em **Download raw file** e abra o arquivo HTML baixado.

Esta prévia possui cadastro e edição de pluviômetros, registro de chuvas, histórico, exclusão, resumo e exportação JSON. Os dados ficam apenas no armazenamento local do navegador (localStorage), sem envio à VPS.

**Limites:** é uma interface demonstrativa, não é o aplicativo Android nativo nem um mecanismo confiável de armazenamento permanente. Limpar dados do navegador pode apagar os registros; exporte o JSON se quiser preservá-los. A sincronização real e SQLite/Room serão implementados no app Android.
