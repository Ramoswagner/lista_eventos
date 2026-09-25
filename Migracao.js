/**
 * ============================================================
 * MIGRACAO.GS — Diagnóstico e migração de dados legados
 * ============================================================
 * Execute no editor do Apps Script:
 *   1. diagnosticoSistema()  → ver o que existe na planilha
 *   2. migrarQRTokens()       → corrigir convites sem QR_Token
 *   3. setupCompleto()        → setup inicial completo (primeira vez)
 *   4. corrigirDatasEventos() → corrige eventos/lotes gravados um dia antes
 *                               (bug de fuso horário das versões antigas)
 * ============================================================
 */

// ------------------------------------------------------------
// DIAGNÓSTICO: mostra todas as abas e quantas linhas têm
// ------------------------------------------------------------
function diagnosticoSistema() {
  _somenteEditor_();
  const ss = _getSpreadsheet_(); // usa openById(CONFIG.SPREADSHEET_ID)
  const abas = ss.getSheets();

  Logger.log('=== DIAGNÓSTICO DO SISTEMA ===');
  Logger.log('Planilha: ' + ss.getName() + ' (' + ss.getId() + ')');
  Logger.log('Total de abas: ' + abas.length);
  Logger.log('');

  const esperadas = Object.values(DB).map(s => s.nome);

  abas.forEach(aba => {
    const nome     = aba.getName();
    const linhas   = aba.getLastRow();
    const esperada = esperadas.indexOf(nome) !== -1 ? '✅' : '⚠️ (não usada pelo sistema)';
    Logger.log(esperada + ' [' + nome + '] — ' + linhas + ' linha(s)');
    if (linhas >= 1) {
      const cols = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1)).getValues()[0];
      Logger.log('   Colunas: ' + cols.filter(h => h).join(' | '));
    }
  });

  Logger.log('');
  Logger.log('=== CONVITES SEM QR_TOKEN ===');
  try {
    const convites = dbListar_(DB.CONVITES);
    const semQR    = convites.filter(c => !c.QR_Token);
    Logger.log('Total de convites: ' + convites.length);
    Logger.log('Sem QR_Token: ' + semQR.length);
    if (semQR.length > 0) Logger.log('→ Execute migrarQRTokens() para corrigir.');
    else Logger.log('→ Todos os convites têm QR_Token. ✅');
  } catch (e) {
    Logger.log('Erro ao ler convites: ' + e.message);
  }

  Logger.log('');
  Logger.log('=== GESTORES/LOGINS ===');
  try {
    const gestores = dbListar_(DB.GESTORES);
    Logger.log('Total de gestores: ' + gestores.length);
    gestores.forEach(g => Logger.log('  • ' + g.Nome + ' (' + g.Perfil + ') — setor: ' + g.Setor + ' — ativo: ' + g.Ativo));
    if (!gestores.length) Logger.log('→ Nenhum gestor. Execute criarAdminInicial().');
  } catch (e) {
    Logger.log('Erro ao ler gestores: ' + e.message);
  }
}

// ------------------------------------------------------------
// MIGRAÇÃO: gera QR_Token para convites que não têm
// Seguro rodar várias vezes (só toca quem está vazio)
// ------------------------------------------------------------
function migrarQRTokens() {
  _somenteEditor_();
  Logger.log('=== MIGRANDO QR_TOKENS ===');
  try {
    const convites = dbListar_(DB.CONVITES);
    let corrigidos = 0;
    convites.forEach(c => {
      if (!c.QR_Token || c.QR_Token.toString().trim() === '') {
        const novoToken = Utilities.getUuid();
        dbAtualizar_(DB.CONVITES, c.ID_Convite, {
          QR_Token:  novoToken,
          QR_Valido: (c.Status === 'Cancelado' || c.Status === 'Substituído') ? 'Não' : 'Sim'
        });
        corrigidos++;
      }
    });
    Logger.log('✅ Corrigidos: ' + corrigidos + ' convite(s).');
    if (corrigidos === 0) Logger.log('Todos os convites já tinham QR_Token.');
  } catch (e) {
    Logger.log('❌ Erro: ' + e.message);
  }
}

// ------------------------------------------------------------
// SETUP COMPLETO (primeira vez no novo sistema):
//   1. Cria as abas novas (sem apagar as antigas)
//   2. Cria o admin inicial
//   3. Gera QR tokens nos convites existentes
// ------------------------------------------------------------
function setupCompleto() {
  _somenteEditor_();
  Logger.log('=== SETUP COMPLETO ===');
  Logger.log('Planilha: ' + CONFIG.SPREADSHEET_ID);

  Logger.log('1. Criando estrutura do banco...');
  setupDatabase();

  Logger.log('2. Criando admin inicial...');
  _criarAdminPadrao_();

  Logger.log('3. Migrando QR Tokens de convites existentes...');
  migrarQRTokens();

  Logger.log('✅ Setup concluído! Login: setor "' + ADMIN_PADRAO.SETOR + '" / senha "' + ADMIN_PADRAO.SENHA + '" — troque a senha em Configurações.');
}

// ------------------------------------------------------------
// CORREÇÃO DE DATAS (rodar UMA vez, só se os eventos antigos
// aparecem com a data um dia antes do correto)
// Versões antigas gravavam a data do formulário como meia-noite UTC,
// que em São Paulo vira 21:00 do dia anterior. Esta função empurra
// essas datas para a meia-noite do dia certo (e, nos lotes, para o fim
// do dia de expiração). Datas que não estão às 21:00 não são tocadas.
// ------------------------------------------------------------
function corrigirDatasEventos() {
  _somenteEditor_();
  function ehMeiaNoiteUTC(v) {
    if (!v) return false;
    const d = new Date(v);
    return !isNaN(d.getTime()) && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
           Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm') !== '00:00';
  }
  function diaUTC(v, fimDoDia) {
    const d = new Date(v);
    return fimDoDia
      ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)
      : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  let nEventos = 0, nLotes = 0;
  dbListar_(DB.EVENTOS).forEach(e => {
    if (ehMeiaNoiteUTC(e.Data)) { dbAtualizar_(DB.EVENTOS, e.ID_Evento, { Data: diaUTC(e.Data) }); nEventos++; }
  });
  dbListar_(DB.LOTES).forEach(l => {
    if (ehMeiaNoiteUTC(l.Data_Expiracao)) { dbAtualizar_(DB.LOTES, l.ID_Lote, { Data_Expiracao: diaUTC(l.Data_Expiracao, true) }); nLotes++; }
  });
  Logger.log('✅ Datas corrigidas: ' + nEventos + ' evento(s), ' + nLotes + ' lote(s).');
}

// ------------------------------------------------------------
// RESETAR TUDO — apaga todos os dados (eventos, pessoas, empresas,
// convites, lotes, logins, logs…) e recria o admin padrão (adm / 1234).
// Mantém a aba Config (logo e endereço dos links).
// Segurança: precisa rodar DUAS vezes em até 2 minutos. A primeira
// execução só "arma" o reset e explica no log; a segunda apaga.
// ------------------------------------------------------------
function resetarTudo() {
  _somenteEditor_();
  const props = PropertiesService.getScriptProperties();
  const armado = Number(props.getProperty('RESET_ARMADO') || 0);
  if (!armado || Date.now() - armado > 2 * 60 * 1000) {
    props.setProperty('RESET_ARMADO', String(Date.now()));
    Logger.log('⚠️ ATENÇÃO: isto vai APAGAR TODOS OS DADOS do sistema (menos logo e endereço dos links).');
    Logger.log('Para confirmar, execute resetarTudo() de novo nos próximos 2 minutos.');
    return;
  }
  props.deleteProperty('RESET_ARMADO');

  _comLock_(function() {
    const ss = _getSpreadsheet_();
    Object.keys(DB).forEach(chave => {
      const schema = DB[chave];
      if (schema === DB.CONFIG) return;
      const aba = _garantirAba_(ss, schema);
      const ultima = aba.getLastRow();
      if (ultima >= 2) aba.getRange(2, 1, ultima - 1, aba.getMaxColumns()).clearContent();
      // Sobe a versão (não zera) para o cache antigo nunca mais ser lido.
      _bumpVersao_(schema);
    });
  });
  _criarAdminPadrao_();
  Logger.log('✅ Tudo apagado. Login: setor "' + ADMIN_PADRAO.SETOR + '" / senha "' + ADMIN_PADRAO.SENHA + '".');
}

// ------------------------------------------------------------
// DADOS DE EXEMPLO — um cenário realista para testar tudo:
//  • Evento "Jantar Beneficente" HOJE (check-in aberto), capacidade 40
//  • Evento "Congresso de Saúde" daqui a 30 dias (check-in fechado)
//  • 2 empresas, 8 pessoas de categorias variadas
//  • Convites em todos os status: Convidado, Confirmado, Recusado,
//    Presente, Cancelado, uma Substituição e um Walk-in
//  • Um lote público de 5 vagas com 2 inscritos
//  • Logins de teste (senha 1234): gestor, organizador, recepcao, consulta
// Tudo leva "(EXEMPLO)" no nome. Para apagar só isso: removerDadosExemplo().
// ------------------------------------------------------------
function criarDadosExemplo() {
  _somenteEditor_();
  if (dbListar_(DB.EVENTOS, e => /\(EXEMPLO\)/.test(_s_(e.Nome))).length) {
    Logger.log('Já existem dados de exemplo. Rode removerDadosExemplo() antes de criar de novo.');
    return;
  }
  if (!dbListar_(DB.GESTORES).length) _criarAdminPadrao_();
  const hoje = new Date();
  const hojeMeiaNoite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const daqui30 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 30);
  const TAG = 'EXEMPLO';

  // Logins de teste
  [['Gestora de Eventos', 'gestor', 'Gestor'],
   ['Organizador Voluntário', 'organizador', 'Organizador'],
   ['Recepção Portaria', 'recepcao', 'Recepcao'],
   ['Diretoria (consulta)', 'consulta', 'Consulta']].forEach(l => {
    const existe = dbListar_(DB.GESTORES, g => _s_(g.Setor).toLowerCase() === l[1]).length;
    if (!existe) dbInserir_(DB.GESTORES, { Nome: l[0] + ' (EXEMPLO)', Setor: l[1], Perfil: l[2], Senha_Hash: hashSenha_('1234'), Cargo: TAG, Ativo: 'Sim', Criado_Em: new Date() });
  });

  // Eventos
  const jantar = dbInserir_(DB.EVENTOS, { Nome: 'Jantar Beneficente (EXEMPLO)', Data: hojeMeiaNoite, Local: 'Salão Nobre — Hospital da Baleia', Capacidade: 40, Status: 'Ativo', Observacoes: 'Jantar anual de relacionamento com parceiros, doadores e autoridades, com apresentação dos resultados do ano e dos projetos de expansão do hospital. (Evento de EXEMPLO para testes.)', Criado_Em: new Date() });
  const congresso = dbInserir_(DB.EVENTOS, { Nome: 'Congresso de Saúde (EXEMPLO)', Data: daqui30, Local: 'Auditório Principal', Capacidade: 120, Status: 'Planejamento', Observacoes: 'Encontro com o corpo clínico e convidados externos sobre inovação em saúde. (Evento de EXEMPLO para testes.)', Criado_Em: new Date() });

  // Empresas
  const emp1 = dbInserir_(DB.EMPRESAS, { Nome: 'Construtora Horizonte (EXEMPLO)', Segmento: 'Construção civil', Cidade: 'Belo Horizonte', UF: 'MG', Contato: 'Paula Mendes', Observacoes: TAG, Criado_Em: new Date() });
  const emp2 = dbInserir_(DB.EMPRESAS, { Nome: 'Farmácia Vida (EXEMPLO)', Segmento: 'Saúde', Cidade: 'Contagem', UF: 'MG', Contato: 'Ricardo Alves', Observacoes: TAG, Criado_Em: new Date() });

  // Pessoas (CPFs fictícios, com zero à esquerda para testar)
  function pessoa(nome, doc, cat, idEmp, cargo, email) {
    return dbInserir_(DB.PESSOAS, { Nome: nome + ' (EXEMPLO)', Documento: doc, Email: email || '', Telefone: '+55 31 99999-0000', ID_Empresa: idEmp || '', Cargo: cargo || '', Cidade: 'Belo Horizonte', UF: 'MG', Categoria: cat, Observacoes: TAG, Data_Cadastro: new Date(), Ativo: 'Sim' }).ID_Pessoa;
  }
  const pAna     = pessoa('Ana Souza',        '012.345.678-90', 'Empresário',     emp1.ID_Empresa, 'Diretora',   'ana@exemplo.com');
  const pBruno   = pessoa('Bruno Lima',       '023.456.789-01', 'Médico',         '',              'Cardiologista');
  const pCarla   = pessoa('Carla Dias',       '034.567.890-12', 'Deputado',       '',              'Deputada Estadual');
  const pDaniel  = pessoa('Daniel Rocha',     '045.678.901-23', 'Doador',         '',              '');
  const pElisa   = pessoa('Elisa Martins',    '056.789.012-34', 'Imprensa',       '',              'Repórter');
  const pFabio   = pessoa('Fábio Nunes',      '067.890.123-45', 'Fornecedor',     emp2.ID_Empresa, 'Gerente');
  const pGabi    = pessoa('Gabriela Castro',  '078.901.234-56', 'Parceiro',       emp1.ID_Empresa, 'Assessora',  'gabi@exemplo.com');
  const pHugo    = pessoa('Hugo Pereira',     '089.012.345-67', 'Conselheiro',    '',              '');

  const gestor = 'Administrador';
  const cAna    = convidarPessoa_(jantar.ID_Evento, pAna, gestor, null, 'Mesa principal');
  const cBruno  = convidarPessoa_(jantar.ID_Evento, pBruno, gestor);
  const cCarla  = convidarPessoa_(jantar.ID_Evento, pCarla, gestor, null, 'Autoridade — reservar lugar');
  const cDaniel = convidarPessoa_(jantar.ID_Evento, pDaniel, gestor);
  const cElisa  = convidarPessoa_(jantar.ID_Evento, pElisa, gestor);
  const cFabio  = convidarPessoa_(jantar.ID_Evento, pFabio, gestor);
  convidarPessoa_(congresso.ID_Evento, pBruno, gestor);
  convidarPessoa_(congresso.ID_Evento, pHugo, gestor);

  responderConvite_(cAna.ID_Convite, 'Confirmado');
  responderConvite_(cBruno.ID_Convite, 'Confirmado');
  responderConvite_(cDaniel.ID_Convite, 'Recusado');
  fazerCheckin_(cBruno.ID_Convite, 'Recepção Portaria · recepcao');
  dbAtualizar_(DB.CONVITES, cElisa.ID_Convite, { Status: 'Cancelado', QR_Valido: 'Não', Observacoes: 'Cancelado (EXEMPLO)' });
  const pSubst = pessoa('Igor Teixeira', '090.123.456-78', 'Fornecedor', emp2.ID_Empresa, 'Supervisor');
  substituirConvidado_(cFabio.ID_Convite, pSubst, 'Titular viajando', 'Administrador');
  registrarWalkin_(jantar.ID_Evento, { dadosNovaPessoa: { Nome: 'Júlia Ramos (EXEMPLO)', Categoria: 'Pessoa Física' }, autorizadoPor: 'Administrador', checkinPor: 'Recepção Portaria · recepcao' });

  // Lote público com 5 vagas e 2 inscritos
  const lote = dbInserir_(DB.LOTES, { ID_Evento: jantar.ID_Evento, ID_Empresa: emp1.ID_Empresa, Gestor: gestor, Token: Utilities.getUuid(), Vagas_Total: 5, Status: 'Aberto', Data_Expiracao: '', Observacoes: TAG, Criado_Em: new Date() });
  convidarPessoa_(jantar.ID_Evento, pGabi, gestor, lote.ID_Lote);
  const pKleber = pessoa('Kléber Andrade', '001.234.567-89', 'Empresário', emp1.ID_Empresa, 'Sócio', 'kleber@exemplo.com');
  convidarPessoa_(jantar.ID_Evento, pKleber, gestor, lote.ID_Lote);

  let base = '';
  try { base = _urlBase_(); } catch (e) { base = ''; }
  Logger.log('✅ Dados de exemplo criados.');
  Logger.log('Logins de teste (senha 1234): gestor, organizador, recepcao, consulta — e o seu admin.');
  if (base) {
    Logger.log('Link do lote (teste como empresa): ' + base + '?pagina=convite&token=' + lote.Token);
    Logger.log('Link pessoal da Ana (confirmar + QR): ' + base + '?pagina=confirmar&token=' + cAna.QR_Token);
    Logger.log('Na página do lote, busque por "kleber@exemplo.com" para testar confirmar/cancelar.');
  } else {
    Logger.log('O app ainda não foi implantado: implante (Implantar → Nova implantação → App da Web) para ver os links.');
  }
}

// Remove só o que criarDadosExemplo() criou (tudo com "(EXEMPLO)").
function removerDadosExemplo() {
  _somenteEditor_();
  const ehEx = v => /\(EXEMPLO\)/.test(_s_(v));
  const eventos = dbListar_(DB.EVENTOS, e => ehEx(e.Nome)).map(e => e.ID_Evento);
  const nConv = dbExcluirVarios_(DB.CONVITES, c => eventos.indexOf(_s_(c.ID_Evento)) !== -1);
  dbExcluirVarios_(DB.LOTES, l => eventos.indexOf(_s_(l.ID_Evento)) !== -1);
  dbExcluirVarios_(DB.MESAS, m => eventos.indexOf(_s_(m.ID_Evento)) !== -1);
  dbExcluirVarios_(DB.EVENTOS, e => ehEx(e.Nome));
  dbExcluirVarios_(DB.PESSOAS, p => ehEx(p.Nome));
  dbExcluirVarios_(DB.EMPRESAS, e => ehEx(e.Nome));
  dbExcluirVarios_(DB.GESTORES, g => ehEx(g.Nome));
  Logger.log('✅ Dados de exemplo removidos (' + eventos.length + ' evento(s), ' + nConv + ' convite(s)).');
}
