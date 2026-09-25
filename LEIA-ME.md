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
| Gestor | Eventos, listas, lotes e check-in |
| Organizador | Cadastrar pessoas e adicioná-las às listas |
| Recepção | Check-in na entrada |
| Consulta | Só visualiza |

O administrador ajusta isso em **Configurações → Permissões por perfil**.
Cada usuário troca a própria senha no menu (**Trocar minha senha**); o administrador redefine a senha de quem esqueceu em **Configurações → Logins** (botão da chave).

## Links

Os links (lote para empresas e link pessoal de confirmação com QR Code) são montados na hora a partir do endereço do app.
Se o endereço mudar (nova implantação), ajuste em **Configurações → Endereço dos links públicos** e todos os links voltam a valer.
Links abertos pelo endereço de teste (`/dev`) são corrigidos automaticamente para `/exec`.
