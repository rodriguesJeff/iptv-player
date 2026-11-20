## ADDED Requirements

### Requirement: Sincronização entre dispositivos
O sistema SHALL sincronizar favoritos e progresso de séries entre dispositivos (web, Android, Tizen) que usam a mesma conta IPTV e o mesmo servidor de sincronização, mantendo o localStorage como cache offline.

#### Scenario: Favorito em outro dispositivo
- **WHEN** o usuário favorita uma série no Android e depois abre o app na TV Tizen com a mesma conta
- **THEN** a série aparece na aba Favoritos da TV após a sincronização do login

#### Scenario: Continuar em outro dispositivo
- **WHEN** o usuário para T1E4 em 20:00 no navegador e abre a mesma série no Android
- **THEN** o botão mostra "Continuar T1E4" e retoma perto de 20:00

#### Scenario: Servidor de sincronização indisponível
- **WHEN** o servidor de sincronização não responde ou retorna erro
- **THEN** o app continua funcionando com os dados locais e reenvia as mudanças pendentes na próxima sincronização bem-sucedida

#### Scenario: Sincronização desativada
- **WHEN** o campo "Servidor de sincronização" está vazio no Android/Tizen
- **THEN** nenhum dado é enviado e o comportamento é o da persistência apenas local

### Requirement: Resolução de conflitos
O sistema SHALL mesclar dados de dispositivos diferentes item a item (favorito, episódio, último episódio da série), prevalecendo a alteração com horário mais recente, e SHALL representar remoções de favoritos como marcas de exclusão para que não sejam restauradas por outro dispositivo.

#### Scenario: Desfavoritar enquanto outro dispositivo está offline
- **WHEN** o usuário remove um favorito na web e depois um Android que ainda tinha esse favorito em cache sincroniza
- **THEN** o favorito continua removido em todos os dispositivos

#### Scenario: Progresso de episódios diferentes
- **WHEN** dois dispositivos gravam progresso de episódios diferentes da mesma série
- **THEN** os dois progressos são mantidos e o último episódio da série é o gravado mais recentemente

### Requirement: Servidor IPTV escolhido pelo usuário
O serviço de sincronização SHALL validar as credenciais no `player_api.php` do servidor IPTV informado pelo usuário no login e SHALL usar `IPTV_UPSTREAM` apenas quando o servidor informado estiver vazio ou for a própria origem pública do deploy web.

#### Scenario: Servidor digitado pelo usuário
- **WHEN** o usuário faz login com o servidor `http://provedor-b.example:8080`
- **THEN** o serviço valida as credenciais em `http://provedor-b.example:8080/player_api.php` e ignora `IPTV_UPSTREAM`

#### Scenario: Login pela web na própria origem
- **WHEN** o usuário faz login na web informando a própria origem do deploy (ou deixa o servidor vazio)
- **THEN** o serviço valida as credenciais em `IPTV_UPSTREAM`

#### Scenario: Isolamento por servidor
- **WHEN** a mesma combinação usuário/senha é válida em dois servidores IPTV diferentes
- **THEN** cada servidor tem seus próprios dados sincronizados e um não acessa os dados do outro

#### Scenario: Credenciais inválidas
- **WHEN** o servidor IPTV responde `auth` diferente de `1`
- **THEN** o serviço responde 401 sem criar nem ler dados

### Requirement: Proteção contra SSRF
O serviço SHALL contactar servidores IPTV informados pelo usuário somente via `http`/`https`, somente no caminho `/player_api.php`, e SHALL recusar destinos que resolvam para endereços de loopback, rede privada, link-local, CGNAT, multicast ou metadados de nuvem, exceto o host configurado em `IPTV_UPSTREAM`.

#### Scenario: Destino interno
- **WHEN** o usuário informa `http://127.0.0.1:2375`, `http://169.254.169.254` ou um hostname que resolve para `10.0.0.5`
- **THEN** o serviço recusa a validação com erro genérico e não abre conexão com o destino

#### Scenario: DNS rebinding
- **WHEN** o hostname informado resolve para um IP público na verificação e para um IP privado depois
- **THEN** a conexão usa o IP verificado na resolução e nunca o IP privado

#### Scenario: Redirecionamento
- **WHEN** o servidor informado responde com redirecionamento HTTP
- **THEN** o serviço não segue o redirecionamento e trata a validação como falha

#### Scenario: Resposta abusiva
- **WHEN** o servidor informado demora mais de 8 segundos ou responde com mais de 64 KB
- **THEN** o serviço aborta a requisição e responde erro sem travar outras requisições

### Requirement: Sessão e credenciais
O serviço SHALL trocar as credenciais IPTV válidas por um token de sessão aleatório e SHALL NOT persistir a senha IPTV, registrá-la em logs ou devolvê-la em respostas.

#### Scenario: Login de sincronização
- **WHEN** o cliente envia servidor, usuário e senha válidos para `POST /sync/session`
- **THEN** o serviço responde um token aleatório de pelo menos 256 bits com validade definida, e guarda apenas o hash do token

#### Scenario: Uso do token
- **WHEN** o cliente chama `GET` ou `POST /sync/library` com `Authorization: Bearer <token>` válido
- **THEN** o serviço atende apenas os dados do namespace associado ao token

#### Scenario: Token expirado ou inválido
- **WHEN** o token está expirado, revogado ou não existe
- **THEN** o serviço responde 401 e o cliente obtém novo token com as credenciais salvas no dispositivo

#### Scenario: Logs
- **WHEN** qualquer requisição é registrada em log
- **THEN** o log não contém senha, token, corpo da requisição nem query string

### Requirement: Endurecimento do serviço
O serviço SHALL limitar abuso e exposição: limite de tentativas de sessão por IP, limite de tamanho de corpo, validação do formato dos dados, erros genéricos sem stack trace, execução como usuário não-root e segredos apenas em variáveis de ambiente do ambiente de deploy.

#### Scenario: Força bruta
- **WHEN** um mesmo IP faz mais de 10 tentativas de sessão falhas em 15 minutos
- **THEN** o serviço responde 429 até o fim da janela

#### Scenario: Corpo grande ou inválido
- **WHEN** o cliente envia corpo maior que 256 KB ou JSON fora do formato esperado
- **THEN** o serviço responde 413 ou 400 sem alterar os dados armazenados

#### Scenario: Segredo ausente
- **WHEN** o serviço inicia sem `SYNC_SECRET` ou com valor menor que 32 bytes
- **THEN** o serviço não inicia e registra o motivo sem imprimir valores de ambiente

#### Scenario: Nada sensível no cliente nem no repositório
- **WHEN** os arquivos de `www/`, o APK, o `.wgt` ou o repositório são inspecionados
- **THEN** não contêm `SYNC_SECRET`, `IPTV_UPSTREAM` real, tokens ou credenciais; o repositório traz apenas `.env.example` com valores fictícios
