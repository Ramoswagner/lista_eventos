# Sistema de Eventos — Hospital da Baleia

Google Apps Script (web app) com a planilha Google como banco de dados.

## Publicar (clasp)

```bash
clasp push
```

Depois, no editor do Apps Script: **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**.
Sem isso o site publicado continua na versão antiga.

## Primeira vez / testes

No editor do Apps Script, escolha a função na barra de execução e clique em **Executar**:

| Função | O que faz |
|---|---|
| `setupCompleto` | Cria as abas, o admin (`adm` / `1234`) e corrige convites antigos sem QR |
| `criarDadosExemplo` | Cria um cenário de teste completo (2 eventos, convidados em todos os status, lote público, logins `gestor`, `organizador`, `recepcao`, `consulta` com senha `1234`). O log mostra os links para testar |
| `removerDadosExemplo` | Apaga só o que o exemplo criou (tudo com "(EXEMPLO)" no nome) |
| `resetarTudo` | Apaga **todos** os dados (mantém logo e endereço dos links) e recria `adm` / `1234`. Precisa rodar **duas vezes em até 2 minutos** para confirmar |
| `resetAdmin` | Volta o login do administrador para `adm` / `1234` |
| `corrigirDatasEventos` | Só se eventos antigos aparecem um dia antes: corrige as datas gravadas pela versão anterior |
| `diagnosticoSistema` | Mostra as abas, quantidade de registros e logins no log |

Essas funções só rodam pelo editor (bloqueadas para visitantes do site).

## Perfis

| Perfil | Padrão |
|---|---|
| Administrador | Tudo, inclusive logins, permissões, logo e endereço dos links |
| Gestor | Eventos, listas, lotes, check-in, mesas e relatórios |
| Organizador | Cadastrar/editar pessoas e empresas, adicionar às listas e gerar relatórios — sempre em nome de um gestor |
| Recepção | Check-in na entrada |
| Consulta | Visualiza e gera relatórios |

O administrador ajusta isso em **Configurações → Permissões por perfil**.
Cada usuário troca a própria senha no menu (**Trocar minha senha**); o administrador redefine a senha de quem esqueceu em **Configurações → Logins** (botão da chave).

## Links

Os links (lote para empresas e link pessoal de confirmação com QR Code) são montados na hora a partir do endereço do app.
Se o endereço mudar (nova implantação), ajuste em **Configurações → Endereço dos links públicos** e todos os links voltam a valer.
Links abertos pelo endereço de teste (`/dev`) são corrigidos automaticamente para `/exec`.

## Mesas

Aba **Mesas** dentro do evento. A planta é em **escala real (metros)**:

- **Salão**: largura × profundidade, **corredor mínimo** (espaço livre entre os encostos das cadeiras de mesas vizinhas; 0,90 m confortável, 1,20 m para cadeira de rodas) e distância das paredes.
- **Tamanho real das mesas**: automático pelo nº de lugares (redonda de 8 = Ø 1,50 m; de 10 = Ø 1,60 m; de 12 = Ø 1,80 m; retangular = 60 cm por pessoa × 0,80 m) ou informado em metros. Formatos redonda, quadrada e retangular (a retangular pode girar 90°). Cada cadeira ocupa 55 cm a partir da borda.
- **Elementos**: palco, pista de dança, buffet, bar, entrada, banheiros e áreas bloqueadas/pilares, com medidas em metros. Arraste para posicionar; toque para editar.
- **Organizar salão**: posiciona todas as mesas em *grade*, *intercalada* (cabe ~15–30% mais com redondas) ou *dois blocos com corredor central*, sem invadir os elementos, com a numeração a partir do palco e as VIP na frente. Antes de aplicar mostra **quantas mesas cabem** e, se não couberem todas, o que fazer (corredor menor, outro arranjo ou salão de A × B m). Tem **Desfazer**.
- **Mesas novas** nascem na área "fora do salão" e são encaixadas sozinhas nos espaços livres, sem mexer nas outras. O que não couber fica fora do salão, sem sobrepor nada ("Encaixar N de fora").
- **Arrastar**: encaixa de 10 em 10 cm e alinha com as outras mesas (linhas-guia azuis). A área das cadeiras fica verde se o corredor está ok ou vermelha se não. Mesas com pouco espaço ficam marcadas em vermelho, e o rodapé mostra quantas.
- **Zoom**: roda do mouse, pinça no celular ou os botões + / − / ver tudo. Arraste o fundo para mover a vista.
- **Sentar convidados**: marque pessoas em "Sem mesa" e toque na mesa (borda verde = cabe). A capacidade é respeitada.
- **Ver por gestor / Destacar gestor**: cada cadeira na cor do gestor que convidou.
- **Distribuir**: senta automaticamente quem está sem mesa, mantendo juntos empresa, gestor ou categoria; autoridades e apoiadores vão para as mesas VIP.
- Eventos criados antes desta versão são convertidos sozinhos para um salão de 20 × 12,8 m, mantendo o desenho. Ajuste as medidas em **Salão**.
- O relatório **Mapa de mesas** imprime a planta em escala, com as medidas e os elementos.

## Relatórios (PDF)

Aba **Relatórios** do evento: *Lista de convidados* (por gestor), *Presença e check-in*, *Mapa de mesas* e *Panorama*.
Menu **Relatórios**: panorama/comparativo de um ou vários eventos.

"Visualizar relatório" mostra a prévia; **Gerar PDF** abre a impressão do navegador — escolha **Salvar como PDF** (no celular: compartilhar → imprimir → salvar). **Planilha (Excel)** baixa os dados em CSV.

Em **Configurações → Marca dos relatórios** o Admin envia a logo do cabeçalho, a marca d'água e a logo do rodapé, ajusta a intensidade da marca d'água e o texto do rodapé. Sem envio, vale a identidade padrão embutida.

## Página pessoal do convidado

Além de confirmar/recusar e mostrar o QR Code, tem **Atualizar meus dados (opcional)**: o convidado informa só o que mudou (nome, e-mail, telefone, cargo, "quem é você"). Os dados atuais nunca aparecem na página. A página mostra o **nº do convite**.

## Organizadores e gestores

Todo convidado, lote e cadastro pertence a um **gestor**. O Gestor registra sempre em nome dele. O **Organizador** pode ser **vinculado a um gestor** (Configurações → Logins → editar → "Vinculado ao gestor"): tudo o que ele cadastrar conta como do gestor. Sem vínculo, ele escolhe o gestor numa lista a cada cadastro. O Admin pode escolher qualquer gestor. Quem digitou fica registrado para auditoria.

## Diretório

Pessoas e empresas podem ser **editadas** (botão do lápis). Empresa tem **CNPJ** (validado). A **exclusão** é para cadastros feitos por engano: não exclui quem já participou de evento nem quem está em alguma lista; empresa com lote ou com gente que já participou também fica. Ao excluir uma empresa sem histórico, as pessoas vinculadas continuam, só sem empresa.

## Lista de convidados

- **Adicionar**: busque alguém que já está no diretório (evita duplicar) ou cadastre uma pessoa nova.
- **Cancelar** (ícone proibido): mantém o registro, com status Cancelado.
- **Excluir** (lixeira): tira o convite da lista, para a lista ficar limpa. Só até a véspera do evento (o Admin pode corrigir depois). Quem já fez check-in ou faz parte de uma troca não é excluído.
- **Nº do convite** (ícone #): edita o número impresso no convite e a descrição. O número é único por evento.
- **Identificar** (ícone de pessoa): dá nome a uma vaga de grupo ("Convidado 3").
- **Trocar** (setas): quando a pessoa avisa que outra irá no lugar. O original fica como Substituído; quem entra recebe link próprio, a mesma mesa e o mesmo gestor. Excluir o substituto devolve o lugar ao original.

## Relatório da base de contatos

Menu **Relatórios → Base de contatos**: quantidade e pessoas no banco em tabelas por gestor, com listas, presenças e último evento de cada pessoa. Filtre por um gestor ("meus contatos") ou veja a base geral. Também em planilha.

## CPF

O CPF **não é pedido e não é obrigatório** em nenhum formulário (lote, página pessoal, lista).
Se um cadastro antigo tiver CPF, ele fica guardado, mas **nunca aparece** em tela, busca, relatório ou planilha. No Diretório, ao editar, o campo aparece vazio com o aviso "Registrado — em branco mantém"; dá para apagá-lo marcando "Apagar o CPF registrado".

## Nº do convite e vagas de grupo ("Convidado 1, 2, 3…")

- O **nº do convite é definido pelo gestor/organizador**, nunca pelo convidado: ao adicionar na lista, ao criar o lote ou depois, no ícone **#** da lista (e no walk-in, pela recepção).
- **Criar lote**: informe os números do grupo (ex.: `101-110, 115`). Com "Reservar vagas" marcado, o lote já nasce com **Convidado 1, Convidado 2…** da empresa, cada um com seu número — eles aparecem em **Mesas** para distribuir mesmo sem nome.
- Na página do lote, a pessoa informa nome e **e-mail ou telefone** (sem CPF, sem nº). Ela ocupa a próxima vaga "Convidado N" e herda o nº e a mesa que o gestor definiu. Sem vagas reservadas, recebe o próximo nº livre do grupo.
- Para confirmar/cancelar depois: e-mail, **ou** telefone + primeiro nome (ou pelo link pessoal). Cancelar devolve a vaga como "Convidado N" com o mesmo número e mesa.
- Se a empresa não mandar os nomes, as vagas continuam como "Convidado N" e entram assim mesmo no check-in.

## Check-in (recepção)

Painel ao vivo (atualiza sozinho a cada 15 s):

- **Números no topo**: chegaram / esperados, aguardando, mesas cheias e lugares livres, walk-ins.
- **Buscar**: por nome (sem acento), **nº do convite** (`101`, `nº 101`), **empresa**, cargo ou **mesa** (`mesa 3`). O número exato aparece primeiro. Filtros: Todos / Aguardando / Chegaram.
- **Ler QR**: câmera lê o QR Code do link pessoal.
- **Mesas**: cada mesa com lugares reservados, quem chegou e quantos lugares livres (verde = livre, amarelo = quase cheia, vermelho = cheia). Toque para ver quem senta nela e dar entrada.
- **Chegadas**: últimas entradas com horário e progresso de chegada por empresa.
- Vaga "Convidado N": ao dar entrada, a recepção pode digitar o nome (opcional).
- **Walk-in**: pode receber nº do convite e uma mesa (só aparecem mesas com lugar livre).
