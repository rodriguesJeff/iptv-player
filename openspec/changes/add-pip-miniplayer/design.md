# Design

## Context

Ver `proposal.md` - Why. O backend de reprodução é escolhido em tempo de execução por `www/js/player.js` (`tizen` | `droid` | `html5`). Android usa `ExoPlayer`/`PlayerView` controlado via `AndroidBridge` (`android/app/src/main/java/dev/local/iptvplayer/MainActivity.kt`); hoje `onStop()` sempre chama `Player.close()` e libera o player. Web usa `<video>` nativo com `hls.js` quando necessário.

## Goals / Non-Goals

**Goals:**
- Entrar/sair de Picture-in-Picture sem recriar a sessão de stream (evita custo em contas `max_connections: 1`).
- Reaproveitar o backend existente de cada plataforma, sem introduzir dependências novas.
- Expor o recurso apenas onde a plataforma suporta de forma confiável (navegador com PiP e Android com API de PiP).

**Non-Goals:**
- Controles ricos de mídia no PiP Android (apenas play/pause, pode ficar para incremento futuro).
- Suporte a Picture-in-Picture em Tizen.
- Mudar a arquitetura de seleção de backend em `player.js`.

## Decisions

- **Web: `HTMLVideoElement.requestPictureInPicture()`** em vez de `documentPictureInPicture` (Document PiP API). Motivo: `requestPictureInPicture` tem suporte mais amplo (Safari, Firefox, Chrome) e não exige mover todo o OSD/controles para outra janela; o escopo aqui é apenas manter o vídeo visível. Desvantagem aceita: o PiP mostra só o vídeo, sem o OSD custom.
- **Botão de PiP só aparece quando o backend ativo é `html5`** e `document.pictureInPictureEnabled` é `true`. Evita expor controle sem efeito em Tizen/Android nativo (nesses casos o `<video>` não está em uso).
- **Android: `Activity.enterPictureInPictureMode(PictureInPictureParams)`** (API nativa, `minSdk` atual é 21; PiP exige API 24+, então o botão/ação só é oferecido quando `Build.VERSION.SDK_INT >= 24` e `packageManager.hasSystemFeature(FEATURE_PICTURE_IN_PICTURE)`). Sem dependência nova: Media3 já expõe `PlayerView` que continua funcionando dentro da janela PiP.
- **`onStop()` não libera mais o player incondicionalmente**: passa a checar `isInPictureInPictureMode`. Fora do PiP, mantém o comportamento atual (libera a conexão). Em PiP, mantém o player vivo; o `onPictureInPictureModeChanged` decide quando voltar a liberar (ex.: usuário fecha o PiP do sistema, o que dispara `onStop` novamente sem PiP ativo).
- **Entrada em PiP só quando há player ativo**: a `Bridge` expõe `enterPip()` chamada pelo JS a partir de um botão no OSD; se não houver `player` criado, a chamada é ignorada.
- **Sem `MediaSession`/notificação de mídia nesta mudança**: o PiP do Android funciona sem isso (mostra o `PlayerView`); adicionar controles do sistema de notificação é um incremento futuro caso o usuário peça.

## Risks / Trade-offs

- [PiP Android sem controles de play/pause do sistema] → Usuário usa os próprios controles do app antes de entrar em PiP; aceitável para o escopo atual.
- [`requestPictureInPicture` falha silenciosamente em alguns navegadores móveis] → Checar `document.pictureInPictureEnabled` antes de exibir o botão e tratar a `Promise` rejeitada com um aviso (`App.toast`), sem interromper a reprodução.
- [Reter o `ExoPlayer` em `onStop()` durante PiP prende a conexão por mais tempo em contas de conexão única] → Aceitável: PiP é uma ação explícita do usuário para continuar vendo o conteúdo; ao sair do PiP sem retomar o app, o sistema chama `onStop()` novamente e o player é liberado normalmente.
- [Android TV e alguns launchers não suportam ou ignoram PiP] → `enterPip()` verifica `hasSystemFeature` e falha de forma silenciosa (fallback: nada acontece, app continua em primeiro plano).
