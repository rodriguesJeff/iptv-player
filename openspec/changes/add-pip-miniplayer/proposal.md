# Proposal

## Why

O projeto já reproduz vídeo em modo preview e tela cheia, mas não mantém o conteúdo visível quando o usuário navega para fora da aplicação. O miniplayer nativo melhora a continuidade da reprodução em navegadores compatíveis e no aplicativo Android, sem trocar o backend de reprodução existente.

## What Changes

- Adicionar entrada controlada pelo usuário no Picture-in-Picture (PiP) para navegadores compatíveis.
- Adicionar Picture-in-Picture nativo no Android usando o `ExoPlayer` existente.
- Preservar a reprodução e o estado do player durante a transição Android para PiP e de volta à aplicação.
- Exibir controles mínimos de reprodução no PiP Android e manter o comportamento atual como fallback quando PiP não estiver disponível.
- Manter o preview interno existente e não alterar o backend AVPlay do Tizen.

## Capabilities

### New Capabilities

- `miniplayer`: permite continuar a reprodução em uma janela PiP nativa na web compatível e no aplicativo Android, com fallback para o preview interno.

### Modified Capabilities

Nenhuma.

## Impact

- Web: `www/index.html`, `www/js/player.js` e `www/css/app.css`.
- Android: `AndroidManifest.xml` e `MainActivity.kt`.
- Sem novas dependências; usa APIs Picture-in-Picture da plataforma e Media3 já instalado.
- Tizen permanece sem PiP nativo portátil e mantém o comportamento atual.
