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

Aba **Mesas** dentro do evento. Os gestores montam o salão:

- **+ Mesas**: cria várias de uma vez (ex.: 10 redondas de 8 lugares), numeradas em sequência. Mesa pode ter nome ("Diretoria") e ser VIP.
- **Planta**: arraste as mesas para reproduzir o salão; toque numa mesa para ver quem está nela, editar ou excluir.
- **Sentar convidados**: marque pessoas em "Sem mesa" e toque na mesa (borda verde = cabe). A capacidade é respeitada.
- **Ver por gestor / Destacar gestor**: cada cadeira na cor do gestor que convidou — para analisar a distribuição.
- **Distribuir**: senta automaticamente quem está sem mesa, mantendo juntos empresa, gestor ou categoria; autoridades e apoiadores vão para as mesas VIP.
- O check-in mostra a mesa da pessoa; substituto herda a mesa do original; cancelado/recusado libera a cadeira.

## Relatórios (PDF)

Aba **Relatórios** do evento: *Lista de convidados* (por gestor), *Presença e check-in*, *Mapa de mesas* e *Panorama*.
Menu **Relatórios**: panorama/comparativo de um ou vários eventos.

"Visualizar relatório" mostra a prévia; **Gerar PDF** abre a impressão do navegador — escolha **Salvar como PDF** (no celular: compartilhar → imprimir → salvar). **Planilha (Excel)** baixa os dados em CSV.

Em **Configurações → Marca dos relatórios** o Admin envia a logo do cabeçalho, a marca d'água e a logo do rodapé, ajusta a intensidade da marca d'água e o texto do rodapé. Sem envio, vale a identidade padrão embutida.

## Página pessoal do convidado

Além de confirmar/recusar e mostrar o QR Code, tem **Atualizar meus dados (opcional)**: o convidado informa só o que mudou (nome, e-mail, documento, telefone, cargo, "quem é você"). Os dados atuais nunca aparecem na página.

## Organizadores e gestores

Todo convidado, lote e cadastro pertence a um **gestor**. O Gestor registra sempre em nome dele. O **Organizador** pode ser **vinculado a um gestor** (Configurações → Logins → editar → "Vinculado ao gestor"): tudo o que ele cadastrar conta como do gestor. Sem vínculo, ele escolhe o gestor numa lista a cada cadastro. O Admin pode escolher qualquer gestor. Quem digitou fica registrado para auditoria.

## Diretório

Pessoas e empresas podem ser **editadas** (botão do lápis). Empresa tem **CNPJ** (validado). A **exclusão** é para cadastros feitos por engano: não exclui quem já participou de evento nem quem está em alguma lista; empresa com lote ou com gente que já participou também fica. Ao excluir uma empresa sem histórico, as pessoas vinculadas continuam, só sem empresa.

## Lista de convidados

- **Adicionar**: busque alguém que já está no diretório (evita duplicar) ou cadastre uma pessoa nova.
- **Cancelar** (ícone proibido): mantém o registro, com status Cancelado.
- **Excluir** (lixeira): tira o convite da lista, para a lista ficar limpa. Só até a véspera do evento (o Admin pode corrigir depois). Quem já fez check-in ou faz parte de uma troca não é excluído.
- **Trocar** (setas): quando a pessoa avisa que outra irá no lugar. O original fica como Substituído; quem entra recebe link próprio, a mesma mesa e o mesmo gestor. Excluir o substituto devolve o lugar ao original.

## Relatório da base de contatos

Menu **Relatórios → Base de contatos**: quantidade e pessoas no banco em tabelas por gestor, com listas, presenças e último evento de cada pessoa. Filtre por um gestor ("meus contatos") ou veja a base geral. Também em planilha.
