## ADDED Requirements

### Requirement: Registro do progresso de série
O sistema SHALL registrar automaticamente, para cada série, o último episódio reproduzido, a posição atual dentro dele e se o episódio foi concluído, em Android, Tizen e web.

#### Scenario: Progresso salvo durante a reprodução
- **WHEN** um episódio é reproduzido por pelo menos 15 segundos
- **THEN** a série passa a ter como último episódio esse episódio, com a posição atual gravada

#### Scenario: Progresso salvo ao sair
- **WHEN** o usuário fecha o player, troca de app (Android `onStop`, Tizen em segundo plano, aba do navegador oculta) ou o episódio termina
- **THEN** a posição mais recente é gravada antes de o stream ser liberado

#### Scenario: Episódio concluído
- **WHEN** a posição alcança 90% da duração ou faltam menos de 2 minutos para o fim
- **THEN** o episódio é marcado como concluído

#### Scenario: Conteúdo não registrado
- **WHEN** o usuário reproduz um canal ao vivo ou um filme
- **THEN** nenhum progresso de série é registrado

### Requirement: Continuar de onde parou
A tela da série SHALL oferecer um botão "Continuar" quando houver progresso registrado, que abre a temporada correspondente e reproduz o episódio a partir da posição salva.

#### Scenario: Retomar episódio em andamento
- **WHEN** o usuário aciona "Continuar T2E3" numa série cujo último episódio é T2E3, não concluído, parado em 12:34
- **THEN** a temporada 2 é selecionada e o episódio 3 é reproduzido em tela cheia a partir de 12:34

#### Scenario: Último episódio concluído
- **WHEN** o último episódio registrado foi concluído e existe um episódio seguinte (mesma temporada ou primeiro da próxima)
- **THEN** o botão aponta para o episódio seguinte e o reproduz desde o início

#### Scenario: Série terminada
- **WHEN** o último episódio registrado foi concluído e é o último da série
- **THEN** o botão mostra "Rever T{s}E{e}" e reproduz esse episódio desde o início

#### Scenario: Sem progresso
- **WHEN** a série nunca teve episódio reproduzido
- **THEN** o botão "Continuar" não é exibido e a tela abre na primeira temporada, como hoje

#### Scenario: Posição pequena ignorada
- **WHEN** a posição salva é menor que 30 segundos
- **THEN** o episódio é reproduzido desde o início

#### Scenario: Episódio removido do servidor
- **WHEN** o episódio registrado não existe mais na resposta de `get_series_info`
- **THEN** o botão "Continuar" não é exibido e o app não gera erro

### Requirement: Indicação de progresso nos episódios
A lista de episódios SHALL indicar quais episódios foram concluídos e quanto foi assistido dos episódios em andamento.

#### Scenario: Episódio em andamento
- **WHEN** a temporada exibida contém um episódio com posição salva e não concluído
- **THEN** o card mostra uma barra de progresso proporcional à posição

#### Scenario: Episódio concluído
- **WHEN** a temporada exibida contém um episódio concluído
- **THEN** o card mostra a marca "✓ Assistido"

#### Scenario: Retomar pelo card
- **WHEN** o usuário seleciona o card de um episódio em andamento
- **THEN** o episódio é reproduzido a partir da posição salva

### Requirement: Lista Continuar assistindo
O filtro "Continuar assistindo" da aba Favoritos SHALL listar as séries com progresso registrado, da mais recente para a mais antiga, independentemente de serem favoritas.

#### Scenario: Abrir pela lista
- **WHEN** o usuário seleciona uma série em "Continuar assistindo"
- **THEN** a tela da série é aberta com o foco no botão "Continuar"

#### Scenario: Limite de histórico
- **WHEN** existem mais de 100 séries com progresso registrado
- **THEN** as séries assistidas há mais tempo são descartadas do histórico

### Requirement: Retomada nos três backends
O player SHALL aceitar uma posição inicial para conteúdo sob demanda e iniciar a reprodução nela nos backends HTML5, Android (ExoPlayer) e Tizen (AVPlay), sem abrir conexão adicional ao servidor.

#### Scenario: Posição inicial suportada
- **WHEN** um episódio é aberto com posição inicial de 754 segundos
- **THEN** a reprodução começa próximo de 12:34 usando uma única conexão de stream

#### Scenario: Stream não posicionável
- **WHEN** o backend não consegue posicionar o stream na posição inicial
- **THEN** a reprodução continua desde o início e o progresso volta a ser registrado normalmente
