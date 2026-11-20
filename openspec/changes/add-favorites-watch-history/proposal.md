## Why

Hoje o app não guarda nada sobre o que o usuário assiste: para voltar a um filme ou série é preciso navegar de novo pela categoria ou buscar pelo nome, e numa série não há como saber em qual episódio paramos. Catálogos XUI costumam ter milhares de itens, então favoritos e "continuar assistindo" são o atalho que mais economiza navegação por controle remoto.

## What Changes

- Permitir favoritar e desfavoritar **filmes** e **séries** (canais ao vivo ficam fora).
- Nova aba **Favoritos** no topo, com filtros "Continuar assistindo", "Filmes" e "Séries" no painel lateral.
- Marcar com ★ os cards de itens favoritados nas abas Filmes e Séries.
- Registrar automaticamente, por série, o último episódio assistido e a posição dentro dele.
- Na tela da série, botão **Continuar T{s}E{e}** que abre a temporada certa e retoma o episódio na posição salva; se o episódio foi concluído, aponta para o próximo.
- Mostrar progresso/concluído nos cards de episódio.
- Reprodução passa a aceitar posição inicial (retomada) nos três backends: HTML5, Android (ExoPlayer) e Tizen (AVPlay).
- Dados guardados localmente no dispositivo (localStorage), separados por conta (servidor + usuário); sair da conta não apaga favoritos nem histórico.
- **Sincronização opcional entre dispositivos** por um serviço próprio na VPS (`deploy/sync/`, atrás do Caddy em `/sync/*`): mesma conta IPTV em web, Android e Tizen vê os mesmos favoritos e o mesmo progresso. O localStorage continua como cache offline.
- Identidade pelo próprio login IPTV: o serviço valida usuário/senha no `player_api.php` **do servidor que o usuário digitou**; `IPTV_UPSTREAM` (env) só é usado quando o campo de servidor está vazio ou aponta para o próprio domínio do deploy web.
- Endurecimento de segurança do serviço: proteção contra SSRF ao contactar servidores informados pelo usuário, token de sessão em vez de reenviar a senha, segredos apenas em variáveis de ambiente do Dokploy (nada em `www/` nem no repositório), sem credenciais em logs.

Fora de escopo: favoritos de canais ao vivo, retomada de posição em filmes, reprodução automática do próximo episódio, proxy de streaming web para servidores IPTV diferentes do `IPTV_UPSTREAM`.

## Capabilities

### New Capabilities

- `favorites`: marcar filmes e séries como favoritos, listá-los numa aba dedicada e persistir a lista no dispositivo por conta.
- `series-progress`: registrar o episódio e a posição em que o usuário parou em cada série e permitir retomar dali, inclusive pela lista "Continuar assistindo".
- `library-sync`: sincronizar favoritos e progresso entre dispositivos por um serviço próprio, autenticado pelas credenciais IPTV do servidor escolhido pelo usuário, com requisitos de segurança explícitos.

### Modified Capabilities

Nenhuma (não há specs publicadas em `openspec/specs/`; `miniplayer` ainda está em change aberta e não é afetada).

## Impact

- Web compartilhado (usado por web, Android e Tizen): novo `www/js/library.js`; mudanças em `www/js/app.js`, `www/js/player.js`, `www/index.html`, `www/css/app.css`.
- Android: `MainActivity.kt` — `AndroidBridge.open` ganha parâmetro de posição inicial (`ExoPlayer.setMediaItem(item, startMs)`). Assinatura JS↔nativo muda junto com o `www/` empacotado no APK.
- Tizen: apenas JS (`avplay.seekTo` após `prepareAsync`); nenhum privilégio novo em `config.xml`.
- Novo serviço `deploy/sync/` (Node.js sem dependências, `Dockerfile` próprio, usuário não-root, volume de dados) e nova rota `/sync/*` no `deploy/web/Caddyfile`. Novo serviço e volume no Dokploy; segredo `SYNC_SECRET` configurado só lá.
- Login ganha campo opcional "Servidor de sincronização" (Android/Tizen); na web é automático (mesma origem).
- **Muda a regra do README**: além do servidor IPTV, o app pode contactar o servidor de sincronização configurado pelo próprio usuário (opcional). Sem dependências de terceiros, sem analytics.
