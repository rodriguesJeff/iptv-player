# Spec Delta

## Purpose

Permite que usuários continuem assistindo ao conteúdo enquanto navegam fora da tela principal, usando Picture-in-Picture quando a plataforma oferece suporte e preservando um fallback funcional dentro da aplicação.

## ADDED Requirements

### Requirement: Web Picture-in-Picture
A interface web SHALL oferecer entrada explícita no Picture-in-Picture quando o navegador suportar a API e o vídeo estiver sendo reproduzido pelo elemento HTML5.

#### Scenario: Navegador compatível
- **WHEN** o usuário aciona o controle de miniplayer durante reprodução HTML5 e o navegador suporta Picture-in-Picture
- **THEN** o vídeo entra em uma janela Picture-in-Picture sem interromper a reprodução

#### Scenario: Navegador incompatível
- **WHEN** o usuário acessa a interface em navegador sem suporte a Picture-in-Picture
- **THEN** o controle nativo fica indisponível e o preview interno continua utilizável

### Requirement: Android Picture-in-Picture
O aplicativo Android SHALL permitir que uma reprodução ativa entre no modo Picture-in-Picture nativo e SHALL manter o player reproduzindo durante a transição, quando o sistema operacional permitir o recurso.

#### Scenario: Entrada em PiP Android
- **WHEN** o usuário solicita o miniplayer durante uma reprodução ativa
- **THEN** a Activity entra em Picture-in-Picture e o ExoPlayer mantém o item atual e seu estado de reprodução

#### Scenario: Retorno do PiP Android
- **WHEN** o usuário retorna do Picture-in-Picture para a aplicação
- **THEN** a interface recupera o player atual sem abrir uma conexão duplicada

### Requirement: Fallback de plataforma
O sistema SHALL manter o modo preview interno como fallback quando o Picture-in-Picture não estiver disponível, não for permitido ou não for compatível com o backend de reprodução atual.

#### Scenario: Backend não compatível
- **WHEN** a reprodução usa Tizen AVPlay ou outro backend sem API Picture-in-Picture suportada
- **THEN** o sistema mantém o comportamento de preview e tela cheia existente

#### Scenario: Falha ao entrar no PiP
- **WHEN** a plataforma rejeita a solicitação de Picture-in-Picture
- **THEN** a reprodução permanece ativa no modo atual e a interface informa a indisponibilidade sem encerrar o player
