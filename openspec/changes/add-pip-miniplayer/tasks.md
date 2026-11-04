# Tasks

## 1. Picture-in-Picture na Web

- [x] 1.1 Adicionar ao OSD um controle acessível de miniplayer, inicialmente oculto, e verificar que a interface continua navegável por teclado/controle remoto.
- [x] 1.2 Implementar no backend HTML5 a detecção de `document.pictureInPictureEnabled`, a chamada de `video.requestPictureInPicture()` e o tratamento de rejeição com aviso sem parar o vídeo; verificar em navegador compatível e incompatível.
- [x] 1.3 Atualizar o estado visual quando o vídeo entrar ou sair do PiP e verificar que o botão não aparece para os backends Android nativo e Tizen.

## 2. Picture-in-Picture no Android

- [x] 2.1 Declarar suporte a Picture-in-Picture no `AndroidManifest.xml` e manter compatibilidade com `minSdk 21`; verificar compilação do APK.
- [x] 2.2 Implementar na `MainActivity` a verificação de suporte, entrada via `PictureInPictureParams` e método `AndroidBridge.enterPip()`; verificar que a chamada sem player ou em dispositivo incompatível não encerra a Activity.
- [x] 2.3 Ajustar o ciclo de vida para preservar o ExoPlayer durante PiP e liberá-lo ao sair definitivamente; verificar que o item e a posição continuam ativos ao retornar para a Activity.
- [x] 2.4 Expor o comando Android no `player.js` apenas quando o bridge e o suporte nativo estiverem disponíveis, com fallback para o preview; verificar em dispositivo/emulador com e sem suporte a PiP.

## 3. Integração e documentação

- [x] 3.1 Atualizar o `README.md` com suporte, limitações e passos de teste do miniplayer web/Android; verificar que os comandos documentados permanecem válidos.
- [ ] 3.2 Executar `openspec validate add-pip-miniplayer --strict` e `cd android && ./gradlew assembleDebug`; corrigir falhas e registrar o resultado.
- [ ] 3.3 Testar reprodução live e VOD, entrada/saída do PiP e fallback de preview, confirmando que não é aberta uma segunda conexão durante a transição.
