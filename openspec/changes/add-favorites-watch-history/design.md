## Context

Ver `proposal.md` - Why. Toda a interface vive em `www/` e é a mesma nos três alvos: o APK empacota `www/` como assets (`android/app/build.gradle.kts`), o `.wgt` do Tizen também, e o deploy web serve `www/` pelo Caddy com proxy same-origin para o XUI. Portanto favoritos e histórico são implementados uma vez em JS; o único trecho específico por plataforma é a **retomada de posição** dentro de cada backend do `Player` (`html5` | `droid` | `tizen`).

Estado atual relevante:
- `app.js` já persiste a configuração em `localStorage` (`iptv.cfg`) e trata `Api.config()` como fonte de servidor/usuário.
- As abas (`live` | `vod` | `series`) usam `data[kind] = { cats, items }` e `applyFilter()`; `card()`, `openItem()` e `showDetails()` decidem o comportamento por `tab`.
- Episódios são reproduzidos só via `Player.full(entries, i, closed)`; `Player` não expõe posição para fora nem aceita posição inicial. `updateProgress()` roda a cada 1 s em tela cheia.
- Android: `MainActivity.onStop()` chama `Player.close()` antes de liberar o ExoPlayer; `Bridge.position()` lê valores voláteis atualizados a cada 500 ms.
- Em telas < 900 px `#details` fica oculto e o card vai direto para tela cheia.
- Não há framework de testes; validação é manual com `dev/mock-server.js`.

## Goals / Non-Goals

**Goals:**
- Uma única implementação em `www/` para os três alvos, sem dependências novas; o único host extra é o servidor de sincronização do próprio usuário, opcional.
- Sincronizar entre dispositivos usando a própria conta IPTV como identidade, com o servidor IPTV escolhido pelo usuário (env só como padrão).
- Serviço de sincronização seguro por padrão: sem SSRF, sem senha persistida ou logada, segredos só no ambiente do Dokploy.
- Favoritar acessível por D-pad (TV), toque (celular) e mouse (web).
- Retomar série no episódio e na posição em que parou, com no máximo uma conexão de stream (contas `max_connections: 1`).
- Gravação de progresso robusta a fechar o player, sair do app e fim do episódio.

**Non-Goals:**
- Sincronizar com o painel XUI (o XUI não tem API para isso).
- Contas próprias do app (cadastro, e-mail, recuperação de senha): a identidade é a conta IPTV.
- Proxy de **streaming** web para servidores IPTV arbitrários: o Caddy continua fazendo proxy só para `IPTV_UPSTREAM`. Um proxy aberto de vídeo na VPS seria abuso de banda e vetor de SSRF; servidores diferentes funcionam na web só se aceitarem CORS/HTTPS diretamente.
- Favoritar canais ao vivo; retomar posição de filmes; autoplay do próximo episódio.
- Tela de detalhes dedicada para filmes.

## Decisions

### 1. Módulo `Library` em `www/js/library.js`
Novo módulo IIFE (mesmo estilo de `Api`/`Nav`), carregado antes de `app.js`, responsável só por dados:
- `Library.use(server, user)` — seleciona o namespace após login.
- Favoritos: `isFav(kind, id)`, `toggleFav(kind, item) -> bool`, `favs(kind?)`.
- Progresso: `progress(seriesId)`, `saveProgress(series, ep, pos, dur)`, `episodeState(seriesId, epId)`, `recent()`.

Chave: `iptv.lib.v1:` + `server` + `|` + `user` (servidor já normalizado por `Api.configure`). Valor JSON:
```
{ favs: { "vod:123": {kind, id, name, img, ext, category_id, at}, "series:9000": {...} },
  series: { "9000": { name, cover, last: {epId, season, num, ext, title},
                      eps: { "<epId>": {pos, dur, done, at} }, at } } }
```
Gravação síncrona a cada mudança, com `try/catch` (mesmo padrão de `saveCfg`). Leitura feita uma vez em `use()` e mantida em memória.

*Alternativas:* IndexedDB (assíncrono, mais código, suporte irregular no Tizen 6.5 antigo); arquivo nativo via `AndroidBridge` (duplicaria lógica por plataforma). localStorage já funciona nos três (WebView com `domStorageEnabled`, widget Tizen, navegador) e o volume é pequeno.

*Snapshot do item:* favoritos guardam nome, capa, `container_extension` e `category_id` para que a aba Favoritos renderize e reproduza sem baixar o catálogo de Filmes/Séries. Nome/capa podem ficar desatualizados — aceitável.

*Limites:* histórico de séries limitado a 100 (descarta por `at` mais antigo); `eps` por série limitado a 300 entradas; favoritos limitados a 2000 (mesmos limites validados no serviço de sync).

### 2. Aba Favoritos reutiliza a grade existente
Novo botão `data-tab="favs"` em `#tabs`. `ensure('favs')` não usa a API: monta `{ cats, items }` a partir da `Library` a cada seleção (sem cache em `data`), com categorias sintéticas `continue` / `vod` / `series` e cada item carregando `_kind` (`'vod'` | `'series'`). `card()`, `openItem()` e `showDetails()` passam a decidir por `kindOf(it) = it._kind || tab` em vez de `tab` diretamente. Itens de "Continuar assistindo" abrem a série com foco no botão Continuar.

Categoria inicial da aba: "Continuar assistindo" se houver histórico, senão "Filmes". O filtro "Todos" não é exibido (mistura sem valor).

*Alternativa:* tela separada — duplicaria grade, busca e navegação.

### 3. Como favoritar (por superfície)
- **Série:** botão `#series-fav` no cabeçalho de `#series`, ao lado do novo `#series-continue`, dentro de um grupo `data-group="series-actions"`. Alcançável com ↑ a partir dos episódios.
- **Filme (TV/desktop):** botão de favorito no topo de `#info`, renderizado por `showDetails()` para `vod` e `series`. Alcançável com → a partir da coluna direita da grade. `showDetails` reconstrói `#info`, então o botão é recriado com estado atual.
- **Atalhos:** tecla vermelha (`403`, registrar `ColorF0Red` no Tizen) com card focado alterna favorito; `contextmenu` (pressão longa no toque / clique direito) num card faz o mesmo — cobre celular, onde `#details` está oculto.
- **Marca visual:** card de favorito recebe classe `fav` (★ no canto via CSS). Atualizada no lugar após toggle, sem re-render da grade.

*Alternativa:* botão ★ dentro de cada card — dobra os focáveis da grade e piora a navegação espacial de `Nav`.

### 4. Gravação de progresso fora do `Player`
`Player` continua sem saber o que é série. As entradas de episódio ganham dois campos opcionais: `start` (segundos) e `onProgress(cur, dur, final)`. O `Player` chama `onProgress`:
- a cada 15 s enquanto `mode === 'full'` e o item não é live (no mesmo `progressTimer`, contando ticks);
- em `close()` **antes** de `backend.stop()` (com `final = true`);
- no evento `ended` (com `cur = dur`);
- em `document.visibilitychange` → `hidden` e `pagehide` (cobre Tizen em segundo plano e aba web oculta).

No Android, `onStop()` chamava `evaluateJavascript("Player.close()")` (assíncrono) e logo em seguida `releasePlayer()`, que zera a posição antes de o JS ler. **Ajuste feito na implementação:** `releasePlayer()` passa a rodar no callback do `evaluateJavascript`, depois que `Player.close()` gravou o progresso. A `App` monta `onProgress` em `selectSeason()` com `Library.saveProgress(...)`. Posição só é gravada se `dur > 0` (evita apagar progresso com leituras zeradas durante o buffering inicial).

Regra de concluído: `pos >= 0.9 * dur || dur - pos < 120`.

### 5. Posição inicial por backend
`backend.open(item)` passa a respeitar `item.start` (ignorado se `< 30` ou item live):
- **html5:** após `loadedmetadata` (uma vez), `video.currentTime = start`. Funciona para MP4 progressivo e HLS (`hls.js` respeita `currentTime`; alternativa `startPosition` na config do Hls).
- **Android:** `AndroidBridge.open(url, live, startMs)`; nativo usa `setMediaItem(mediaItem, startMs)` antes de `prepare()`. Uma única preparação → uma conexão. Como `www/` e o APK são versionados juntos, a assinatura muda sem compatibilidade retroativa; `droid.open` passa `0` quando não há `start`.
- **Tizen:** no callback de sucesso do `prepareAsync`, `avplay.seekTo(startMs, ok, err)` e `play()` no callback (ou logo em seguida em caso de erro). Em falha de seek, segue do início.

*Alternativa:* abrir e depois chamar `seek(delta)` relativo — gera requisição extra de range e um salto visível; descartado.

### 6. UI da tela da série
- `openSeries(it, opts)` lê `Library.progress(series_id)` e calcula o alvo: último episódio se não concluído; senão o próximo na ordem (temporada numérica, depois `episode_num`); senão "Rever" o último. Se o `epId` não existir mais em `episodes`, o botão é ocultado.
- Temporada inicial = temporada do alvo (hoje é sempre a primeira).
- Cards de episódio: barra `.ep-progress` com largura `pos/dur`, ou selo "✓ Assistido". Clique em episódio em andamento usa `start = pos`.
- Ao voltar do player (`closed` callback), o cabeçalho e o card do episódio são atualizados para refletir o novo progresso.

### 7. Serviço de sincronização (`deploy/sync/`)
- Node.js ≥ 22, **sem dependências** (`node:http`, `node:crypto`, `node:dns`, `node:fs`), mesmo espírito de `dev/mock-server.js`. Menos superfície de supply chain e nada para auditar em `node_modules`.
- Container próprio (`node:22-alpine`), `USER node`, sistema de arquivos read-only exceto o volume `SYNC_DATA_DIR` (`/data`). Escuta só na rede interna do Docker; o Caddy faz `handle /sync/*` → `reverse_proxy sync:8790`. HTTPS terminado pelo Traefik do Dokploy, como hoje.
- Persistência: um arquivo JSON por namespace em `/data/lib/<ns>.json`, escrita atômica (arquivo temporário + `rename`), fila de escrita por namespace para evitar corrida. Sessões em `/data/sessions.json` (só hashes). Sem banco: volume pequeno, uso pessoal.
  *Alternativa:* `node:sqlite` — ainda experimental no Node 22; reavaliar se o número de usuários crescer.
- Variáveis de ambiente (configuradas **somente** no Dokploy; repositório traz só `deploy/sync/.env.example` com valores fictícios e `.env` no `.gitignore`):
  - `SYNC_SECRET` (obrigatório, ≥ 32 bytes aleatórios) — chave HMAC de namespaces e tokens.
  - `IPTV_UPSTREAM` — servidor IPTV padrão (mesmo valor do serviço web).
  - `PUBLIC_ORIGIN` — origem pública do deploy web (ex.: `https://tv.exemplo.com`), usada para reconhecer "o usuário digitou o próprio domínio".
  - `SYNC_DATA_DIR`, `PORT`, `SESSION_TTL_HOURS` (padrão 24), `TRUSTED_PROXY_HOPS` (proxies que acrescentam ao `X-Forwarded-For`; 2 no Dokploy = Traefik + Caddy), `SYNC_ALLOWED_HOSTS` (opcional), `SYNC_ALLOW_PRIVATE` (só dev, para o mock em `localhost`/`10.0.2.2`; recusado se `NODE_ENV=production`).
  O processo nunca imprime `process.env`, e as mensagens de erro de configuração citam só o nome da variável.

### 8. Resolução do servidor IPTV e identidade
Ordem de resolução em `POST /sync/session { server, user, pass }`:
1. Normalizar `server` igual a `Api.configure` (trim, sem barra final, `http://` se faltar esquema) e analisar com `new URL`; aceitar só `http:`/`https:`, sem usuário/senha embutidos na URL, sem path além de `/`.
2. Se `server` está vazio ou tem a mesma origem que `PUBLIC_ORIGIN` → alvo = `IPTV_UPSTREAM` (confiável, pode ser endereço interno do Docker).
3. Caso contrário → alvo = servidor digitado, **ignorando `IPTV_UPSTREAM`**, e passa pelo filtro SSRF (decisão 9).

Namespace = `HMAC-SHA256(SYNC_SECRET, alvoNormalizado + "\n" + user)` em hex. O alvo faz parte da chave: um servidor IPTV malicioso que aceite qualquer usuário só consegue acessar o namespace **dele**, nunca o de outro provedor. O HMAC impede reverter nomes de arquivo em usuário/servidor se o volume vazar.

### 9. Filtro SSRF
- `dns.lookup(host, { all: true })`; recusar se **qualquer** endereço estiver em: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8` e IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) desses intervalos. IPs literais passam pela mesma checagem.
- Conectar ao **IP já verificado** (opção `lookup` customizada em `http.request`/`https.request` que devolve o IP validado; `servername`/`Host` mantêm o hostname para TLS) → sem DNS rebinding.
- Só `GET <alvo>/player_api.php?username=…&password=…`; sem seguir redirecionamentos; timeout total 8 s; corpo limitado a 64 KB; resposta precisa ser JSON com `user_info.auth == 1` (e `status` `Active` quando presente).
- Erros para o cliente são genéricos (`"Não foi possível validar a conta"`), sem distinguir "IP bloqueado" de "host inexistente", para não virar scanner de rede.
- O host de `IPTV_UPSTREAM` é a única exceção ao bloqueio de faixas privadas.

### 10. Sessão, API e endurecimento
- `POST /sync/session` → `{ token, expiresAt }`. Token = 32 bytes de `crypto.randomBytes` em base64url; servidor guarda `HMAC(SYNC_SECRET, token)` → `{ ns, exp }` e busca por essa chave (sem comparação byte a byte de segredo, então não há canal de timing a proteger com `timingSafeEqual`). Máx. 20 sessões por namespace.
- `GET /sync/library` → documento completo do namespace. `POST /sync/library` → mudanças (`{ favs: {...}, series: {...} }`), servidor mescla (decisão 11) e devolve o documento mesclado. `DELETE /sync/session` revoga o token (usado em "Sair").
- Credenciais vão no corpo JSON (nunca em query string) e o token em `Authorization: Bearer`. Sem cookies → sem CSRF; **sem cabeçalhos CORS**: web é same-origin, Android usa `allowUniversalAccessFromFileURLs` e Tizen `<access origin="*">`, então nenhum navegador de terceiro ganha acesso.
- Limites: corpo 256 KB; validação estrita de tipos/tamanhos (ids alfanuméricos ≤ 32, nomes ≤ 200, URLs de imagem ≤ 500 e só `http(s)`), chaves desconhecidas descartadas; 10 falhas de sessão por IP/15 min → 429 (cliente = entrada `TRUSTED_PROXY_HOPS` a partir do fim do `X-Forwarded-For`; o Caddy usa `trusted_proxies static private_ranges` para preservar o que o Traefik escreveu, e entradas forjadas à esquerda são ignoradas); limite global de requisições por token.
- Respostas com `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Type: application/json`. Erros 4xx/5xx genéricos, sem stack trace.
- Log de acesso mínimo: método, rota sem query, status, duração. Nunca corpo, `Authorization`, senha ou token.
- **Revalidação da conta (ajustado na implementação):** revalidar 1×/24 h exigiria guardar a senha. Em vez disso o token vale `SESSION_TTL_HOURS` (24 h por padrão) e o app renova em silêncio com as credenciais já salvas no dispositivo; conta cancelada no provedor perde acesso em até 24 h e a senha nunca é persistida no servidor.
- Respostas 401/404/405/502 em `POST /sync/session` desligam o sync até o próximo login (evita reenviar a senha em loop e cobre deploy web sem serviço de sync: o Caddy responde 502 quando `SYNC_UPSTREAM` não está configurado).

### 11. Mesclagem e cliente
- Cada favorito carrega `at` e, ao remover, vira `{ deleted: true, at }` (tombstone, expurgado após 90 dias). Cada episódio em `eps` e o `last` da série carregam `at`. Mescla = por chave, maior `at` vence; empate → servidor vence. Mesma função em `library.js` e no serviço (código duplicado pequeno, testado com o mesmo conjunto de casos).
- Relógios divergentes: o cliente envia `at` do relógio local; o servidor rejeita `at` mais de 5 min no futuro, substituindo pelo seu horário.
- `Library` ganha fila de mudanças pendentes (persistida no localStorage). Sincroniza: após login, ao voltar ao app (`visibilitychange` → visible), 2 s após cada mudança (debounce) e ao fechar o player. Falhas → mantém pendências, tenta de novo com backoff.
- URL do servidor de sync: na web, a própria origem (`location.origin`) automaticamente quando a página é servida por http(s); no Android/Tizen, campo opcional "Servidor de sincronização" no login, que precisa ser `https://` (`http://` aceito só para `localhost`, `127.0.0.1` e `10.0.2.2`, para desenvolvimento) para não trafegar a senha IPTV em claro até a VPS.
- O token fica no localStorage junto com a config, como as credenciais IPTV já ficam hoje; "Sair" chama `DELETE /sync/session` e apaga o token local.

## Risks / Trade-offs

- [localStorage do WebView/Tizen pode ser limpo pelo sistema ou por "limpar dados"] → Aceito; dados são conveniência, não críticos. Documentar no README.
- [Serviço de sync recebe a senha IPTV] → Só no `POST /sync/session`, via HTTPS obrigatório, nunca persistida nem logada; depois só o token trafega. A web já envia essa senha à VPS hoje pelo proxy do Caddy.
- [Endpoint de sessão usado para sondar a rede/servidores de terceiros (SSRF/scanner)] → Filtro de faixas privadas com IP fixado, sem redirect, só `/player_api.php`, erro genérico, rate limit por IP.
- [Qualquer pessoa com conta em qualquer servidor Xtream consegue criar namespace e ocupar disco] → Limite de corpo, de itens (100 séries/300 eps/2000 favoritos) e rate limit; opcional `SYNC_ALLOWED_HOSTS` (lista de hosts IPTV aceitos) para fechar o serviço a provedores conhecidos. Fica desativado por padrão para cumprir "servidor digitado pelo usuário".
- [Vazamento do volume `/data`] → Conteúdo é só favoritos/progresso; nomes de arquivo são HMAC; tokens só como hash. Rotacionar `SYNC_SECRET` invalida todas as sessões e "perde" os namespaces (documentado).
- [Relógio errado no dispositivo inverte a mesclagem] → Clamp de `at` futuro no servidor; impacto limitado a um item.
- [Sync desligado no Android/Tizen se o usuário não preencher o campo] → Aceito: opt-in explícito; README explica.
- [`contextmenu` não dispara em todos os WebViews/launchers] → Botão no painel de detalhes e tecla vermelha cobrem TV; em celular, a aba Séries também tem o botão na tela da série. Validar no Android real; se falhar, fallback é um botão ★ no OSD acionável por toque (incremento futuro).
- [Leitura de posição zerada logo após abrir/no fechamento pode sobrescrever progresso] → Gravar só com `dur > 0` e nunca reduzir `pos` de um episódio para < 30 s numa gravação `final` ocorrida nos primeiros 15 s de reprodução.
- [Seek inicial falha em streams sem índice/range no servidor] → Reprodução segue do início (cenário de spec); progresso continua sendo gravado.
- [Assinatura do `AndroidBridge.open` muda] → JS e APK são empacotados juntos; nenhum cliente antigo consome o bridge.
- [Snapshot desatualizado em favoritos (filme removido do painel)] → Reprodução falha com o toast de erro existente; usuário pode desfavoritar. Sem verificação contra o catálogo para não baixar listas grandes ao abrir a aba.

## Migration Plan

Entrega em duas etapas na mesma change:
1. **Local** (grupos 1–4 das tasks): funciona sem servidor; pode ir para produção sozinha.
2. **Sync** (grupos 5–7; grupo 8 valida tudo): no primeiro sync de um dispositivo, tudo que está no localStorage sobe como mudanças pendentes e é mesclado — nada se perde ao ativar.

Deploy do sync no Dokploy: criar serviço `sync` com build `deploy/sync/Dockerfile`, volume em `/data`, variáveis `SYNC_SECRET` (gerado com `openssl rand -base64 48`), `IPTV_UPSTREAM`, `PUBLIC_ORIGIN`, sem porta pública; redeploy do serviço web com o novo `Caddyfile`. Rollback: remover a rota `/sync/*` do Caddy; clientes caem para modo local automaticamente. Chave nova no localStorage (`iptv.lib.v1:*`), nenhuma alteração em `iptv.cfg`.

## Open Questions

- Incluir retomada de posição também para filmes numa próxima change? A estrutura (`start`/`onProgress`) já permitiria com pouco código.
- Ativar `SYNC_ALLOWED_HOSTS` em produção (fecha o serviço a provedores conhecidos) ou manter aberto a qualquer servidor digitado? Padrão do plano: aberto, com limites.
