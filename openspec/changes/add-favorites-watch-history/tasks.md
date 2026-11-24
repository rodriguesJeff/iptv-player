## 1. Camada de dados (`www/js/library.js`)

- [x] 1.1 Criar `www/js/library.js` (IIFE `Library`) com `use(server, user)`, leitura/gravação JSON em `iptv.lib.v1:<server>|<user>` protegidas por `try/catch`; incluir o script em `www/index.html` antes de `app.js`. Verificar: sem localStorage (modo privado/bloqueado) o app carrega sem erro.
- [x] 1.2 Implementar favoritos: `isFav`, `toggleFav` (snapshot `kind, id, name, img, ext, category_id, at`) e `favs(kind)` ordenado por `at` desc. Verificar no console do navegador: toggle duas vezes volta ao estado original e persiste após recarregar.
- [x] 1.3 Implementar progresso: `saveProgress(series, ep, pos, dur)` (ignora `dur <= 0`, regra de concluído 90% / < 120 s, atualiza `last` e `at`), `progress(seriesId)`, `episodeState(seriesId, epId)`, `recent()`; aplicar limites de 100 séries e 300 episódios por série. Verificar com chamadas manuais no console.
- [x] 1.4 Chamar `Library.use(cfg.server, cfg.user)` em `doLogin()` após login bem-sucedido. Verificar: duas contas diferentes no mock (alterar usuário) não compartilham dados; "Sair" não apaga a chave.

## 2. Player: posição inicial e callback de progresso

- [x] 2.1 Em `www/js/player.js`, aceitar `item.start` e `item.onProgress(cur, dur, final)`; chamar `onProgress` a cada 15 s em tela cheia (VOD), em `close()` antes de `backend.stop()`, no fim do conteúdo e em `visibilitychange`/`pagehide`. Verificar com `console.log` no mock que as chamadas ocorrem nesses quatro casos.
- [x] 2.2 Backend `html5`: aplicar `start` uma vez em `loadedmetadata` (MP4 e HLS). Verificar no navegador com o MP4 do mock que a reprodução começa na posição passada.
- [ ] 2.3 Backend `tizen`: após `prepareAsync`, `avplay.seekTo(start*1000)` e `play()` no sucesso ou na falha. Verificar na TV (ou registrar como pendente de hardware) que o episódio inicia na posição.
- [ ] 2.4 Android: mudar `Bridge.open(url, live, startMs)` em `MainActivity.kt` para usar `setMediaItem(item, startMs)` quando `startMs > 0`; atualizar `droid.open` para passar `start*1000` (ou `0`). Verificar `cd android && ./gradlew assembleDebug` e, no emulador, que só há uma requisição `/series/...` no log do mock ao retomar.

## 3. Aba Favoritos e marcação de favoritos

- [x] 3.1 Adicionar `<button class="focusable tab" data-tab="favs">Favoritos</button>` em `#tabs`; em `app.js`, fazer `ensure('favs')` montar `{cats, items}` a partir da `Library` (categorias `continue`, `vod`, `series`, sem "Todos"), sem cache em `data`, e escolher a categoria inicial conforme houver histórico. Verificar navegação por D-pad entre abas, categorias e grade.
- [x] 3.2 Introduzir `kindOf(it)` e usá-lo em `card()`, `openItem()` e `showDetails()` para que itens da aba Favoritos se comportem como filme/série. Verificar: filme favorito toca em preview/tela cheia; série favorita abre a tela da série.
- [x] 3.3 Mensagem de lista vazia específica da aba Favoritos ("Use ☆ Favoritar, a tecla vermelha ou pressione e segure um filme/série"). Verificar com localStorage limpo.
- [x] 3.4 Botão de favorito no topo de `#info` para `vod`/`series` em `showDetails()`; tecla vermelha (`403`, registrar `ColorF0Red` no Tizen) e evento `contextmenu` no card alternam favorito com toast. Ignorar na aba Ao vivo. Verificar no navegador (clique direito, botão do painel) e em tela < 900 px.
- [x] 3.5 Classe `.fav` nos cards favoritos (★ via CSS em `www/css/app.css`), atualizada no lugar após toggle, inclusive remover o card da grade quando desfavoritado dentro da aba Favoritos. Verificar visualmente nas abas Filmes, Séries e Favoritos.

## 4. Tela da série: continuar e progresso por episódio

- [x] 4.1 Em `www/index.html`, adicionar ao `.series-head` um grupo `data-group="series-actions"` com `#series-continue` (oculto por padrão) e `#series-fav`; estilizar em `app.css`. Verificar que ↑ a partir dos episódios alcança os botões e ↓ volta.
- [x] 4.2 Em `openSeries()`, calcular o alvo (em andamento → próximo → "Rever"), selecionar a temporada do alvo, configurar rótulo/visibilidade de `#series-continue` e o estado de `#series-fav`; aceitar opção de foco inicial no botão Continuar (usada por "Continuar assistindo"). Verificar no mock os quatro casos da spec (em andamento, concluído com próximo, último concluído, sem progresso) e episódio inexistente.
- [x] 4.3 Em `selectSeason()`, incluir `start` e `onProgress` nas entradas (gravando via `Library.saveProgress`), renderizar `.ep-progress` ou "✓ Assistido" nos cards e retomar pela posição ao clicar em episódio em andamento; no retorno do player, atualizar card e botão Continuar. Verificar: assistir > 15 s, voltar, botão mostra o episódio certo e a barra aparece.

## 5. Serviço de sincronização (`deploy/sync/`)

- [x] 5.1 Criar `deploy/sync/server.js` (Node ≥ 22, sem dependências) com leitura de config do ambiente: falhar ao iniciar sem `SYNC_SECRET` ≥ 32 bytes, recusar `SYNC_ALLOW_PRIVATE` com `NODE_ENV=production`, nunca imprimir valores de ambiente. Criar `deploy/sync/.env.example` só com valores fictícios e garantir `.env`/`*.env` no `.gitignore`. Verificar: iniciar sem segredo falha com mensagem que cita só o nome da variável; `git grep` não encontra segredos.
- [x] 5.2 Implementar resolução do alvo IPTV (vazio ou `PUBLIC_ORIGIN` → `IPTV_UPSTREAM`; senão servidor digitado) e validação de URL (só `http/https`, sem credenciais embutidas, sem path). Verificar com casos unitários (`node --test deploy/sync/test/`).
- [x] 5.3 Implementar filtro SSRF: `dns.lookup` com todos os endereços, bloqueio das faixas da decisão 9 (incluindo IPv4 mapeado em IPv6), conexão fixada no IP verificado, sem redirect, timeout 8 s, limite 64 KB, só `/player_api.php`, erro genérico; exceção apenas para o host de `IPTV_UPSTREAM`. Verificar com testes: `127.0.0.1`, `169.254.169.254`, `[::ffff:10.0.0.1]`, hostname resolvendo para privado, redirect 302 e resposta grande são recusados.
- [x] 5.4 Implementar `POST /sync/session` (valida `auth == 1`, namespace HMAC de alvo+usuário, token 32 bytes base64url, guarda só `sha256(token)` com expiração), `DELETE /sync/session` e rate limit de 10 falhas/IP/15 min com 429. Verificar: senha errada → 401; 11ª falha → 429; arquivo de sessões não contém token nem senha.
- [x] 5.5 Implementar `GET`/`POST /sync/library` com `Authorization: Bearer`, validação estrita do esquema e limites (256 KB, 100 séries, 300 eps, 2000 favoritos), mesclagem por `at` com tombstones e clamp de `at` futuro, escrita atômica e fila por namespace; token com validade `SESSION_TTL_HOURS` (24 h) renovado pelo app no lugar de revalidação periódica (ver design, decisão 10). Verificar com testes de mesclagem (desfavoritar offline, episódios diferentes, empate) e de corpo inválido/grande (400/413 sem alterar dados).
- [x] 5.6 Endurecer respostas e logs: `no-store`, `nosniff`, JSON, sem CORS, erros genéricos sem stack; log só com método, rota sem query, status e duração. Verificar inspecionando logs após login e sync: nenhuma senha, token, corpo ou query string.
- [ ] 5.7 Criar `deploy/sync/Dockerfile` (`node:22-alpine`, `USER node`, `/data` como volume, sem porta pública além da interna). Ajustar `dev/mock-server.js` para não logar a query string (hoje imprime a senha). Verificar `docker build -f deploy/sync/Dockerfile .` e `docker run --read-only -v ...:/data` funcionando.

## 6. Sincronização no cliente

- [x] 6.1 Extrair a função de mesclagem para uso comum (mesmos casos de teste do serviço) e adicionar à `Library` a fila de mudanças pendentes persistida, tombstones de favoritos e `at` em cada item. Verificar: os testes de mesclagem passam contra a versão do cliente.
- [x] 6.2 Criar o cliente de sync (`www/js/sync.js`): obter token via `POST /sync/session`, renovar em 401 com as credenciais salvas, `GET` no login, `POST` com debounce de 2 s, ao voltar ao app e ao fechar o player, backoff em falha. Verificar no navegador com o serviço local: mudanças em uma aba aparecem em outra após voltar o foco.
- [x] 6.3 Login: na web usar `location.origin` automaticamente quando servida por http(s); no Android/Tizen, campo opcional "Servidor de sincronização" que exige `https://` (exceto modo dev). "Sair" chama `DELETE /sync/session` e apaga o token local. Verificar que campo vazio não gera nenhuma requisição `/sync/*`.
- [x] 6.4 Verificar que nenhum segredo ou URL real entra em `www/`, no APK (`unzip -l` + `grep` nos assets) nem no `.wgt`.

## 7. Deploy no Dokploy

- [ ] 7.1 Adicionar `handle /sync/*` → `reverse_proxy {$SYNC_UPSTREAM}` no `deploy/web/Caddyfile` (sem expor o serviço diretamente) e documentar `SYNC_UPSTREAM` no `.env.example` do web. Verificar com `docker compose`/rede local que `/sync/session` responde via Caddy e que o container `sync` não tem porta publicada.
- [x] 7.2 Documentar no README o passo a passo do Dokploy: serviço `sync`, volume `/data`, variáveis (`SYNC_SECRET` gerado com `openssl rand -base64 48`, `IPTV_UPSTREAM`, `PUBLIC_ORIGIN`), configuradas só no painel, e procedimento de rotação do segredo.

## 8. Documentação e validação

- [x] 8.1 Atualizar `README.md`: favoritos (como favoritar por plataforma), "Continuar assistindo", onde os dados ficam, sincronização opcional, nova regra de hosts contactados (IPTV + servidor de sync do usuário) e passos de teste com `dev/mock-server.js` + serviço de sync local (`SYNC_ALLOW_PRIVATE=1`).
- [x] 8.2 Executar `openspec validate add-favorites-watch-history --strict`, `node --test deploy/sync/test/` e `cd android && ./gradlew assembleDebug`; corrigir falhas.
- [ ] 8.3 Teste manual nos três alvos: web (`node dev/mock-server.js`), APK em emulador/dispositivo e `./tizen/build.sh <TV_IP>`; cobrir favoritar/desfavoritar, aba Favoritos, retomar série após fechar o app, favorito/progresso propagando entre dois dispositivos, sync com servidor fora do ar e uma única conexão de stream por retomada. Registrar o que não pôde ser testado (ex.: TV indisponível).
- [x] 8.4 Revisão de segurança do diff (`/security-review`) antes do deploy, com foco em SSRF, logs e exposição de variáveis.
