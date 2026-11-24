## ADDED Requirements

### Requirement: Favoritar filmes e séries
O sistema SHALL permitir que o usuário adicione e remova um filme ou uma série da lista de favoritos em Android, Tizen e web, usando controle remoto (D-pad), toque ou mouse.

#### Scenario: Favoritar série pela tela da série
- **WHEN** o usuário aciona o botão "☆ Favoritar" na tela de uma série
- **THEN** a série entra nos favoritos, o botão passa a mostrar "★ Favorito" e um aviso confirma a ação

#### Scenario: Favoritar filme pelo painel de detalhes
- **WHEN** o usuário, com um filme selecionado na aba Filmes, aciona o botão de favorito do painel de detalhes
- **THEN** o filme entra nos favoritos e o card dele passa a exibir a marca ★

#### Scenario: Favoritar sem painel de detalhes
- **WHEN** o painel de detalhes está oculto (tela estreita) e o usuário pressiona longamente um card de filme ou série, ou pressiona a tecla vermelha do controle com o card focado
- **THEN** o item alterna entre favorito e não favorito e um aviso informa o novo estado

#### Scenario: Remover dos favoritos
- **WHEN** o usuário aciona o controle de favorito de um item que já é favorito
- **THEN** o item sai dos favoritos, a marca ★ some do card e ele deixa de aparecer na aba Favoritos

#### Scenario: Canais ao vivo
- **WHEN** o usuário está na aba Ao vivo
- **THEN** nenhum controle de favorito é exibido e a tecla vermelha/pressão longa não altera favoritos

### Requirement: Aba Favoritos
O sistema SHALL exibir uma aba "Favoritos" com filtros "Continuar assistindo", "Filmes" e "Séries", reutilizando a mesma grade, busca e navegação das demais abas.

#### Scenario: Abrir filme favorito
- **WHEN** o usuário seleciona um filme na aba Favoritos
- **THEN** o filme é reproduzido com o mesmo comportamento de preview/tela cheia da aba Filmes

#### Scenario: Abrir série favorita
- **WHEN** o usuário seleciona uma série na aba Favoritos
- **THEN** a tela da série é aberta, como na aba Séries

#### Scenario: Lista vazia
- **WHEN** não há itens no filtro selecionado
- **THEN** a grade mostra uma mensagem explicando como favoritar

#### Scenario: Busca dentro dos favoritos
- **WHEN** o usuário digita na busca com a aba Favoritos ativa
- **THEN** apenas favoritos cujo nome contém o texto são exibidos

### Requirement: Persistência local por conta
O sistema SHALL guardar favoritos no armazenamento local do dispositivo, separados por servidor e usuário, e SHALL NOT enviá-los a nenhum host além do servidor IPTV e do servidor de sincronização configurado pelo usuário (capability `library-sync`).

#### Scenario: Reabrir o app
- **WHEN** o usuário fecha e reabre o app e faz login na mesma conta
- **THEN** os favoritos anteriores continuam disponíveis

#### Scenario: Outra conta
- **WHEN** o usuário entra com outro servidor ou outro usuário
- **THEN** a aba Favoritos mostra apenas os favoritos dessa conta

#### Scenario: Sair da conta
- **WHEN** o usuário aciona "Sair"
- **THEN** os favoritos da conta são mantidos no dispositivo e voltam a aparecer no próximo login dessa conta

#### Scenario: Armazenamento indisponível
- **WHEN** o localStorage não pode ser lido ou gravado
- **THEN** o app continua funcionando sem favoritos persistidos e não exibe erro bloqueante
