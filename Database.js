/**
 * ============================================================
 * DATABASE.GS - Camada de dados do Sistema de Eventos HB
 * ============================================================
 * Versão refatorada: cache + LockService + versionamento por tabela.
 * Execute setupDatabase() uma única vez para criar a estrutura.
 * É idempotente: pode rodar várias vezes sem perder dados.
 * ============================================================
 */

// ------------------------------------------------------------
// SCHEMA CENTRAL DO BANCO
// ------------------------------------------------------------
const DB = {
  EVENTOS: {
    nome: 'Eventos',
    prefixoId: 'EVT',
    colunas: [
      'ID_Evento', 'Nome', 'Data', 'Local', 'Capacidade',
      'Status', 'Descricao', 'Imagem_URL', 'Cor_Hex',
      'Observacoes', 'Criado_Em'
    ],
    validacoes: {
      Status: ['Planejamento', 'Ativo', 'Encerrado']
    }
  },

  PESSOAS: {
    nome: 'Pessoas',
    prefixoId: 'P',
    colunas: [
      'ID_Pessoa', 'Nome', 'Documento', 'Telefone', 'Email',
      'ID_Empresa', 'Cargo', 'Cidade', 'UF', 'Pais',
      'Categoria', 'Foto_URL', 'Observacoes',
      'Data_Cadastro', 'Ativo'
    ],
    validacoes: {
      Ativo: ['Sim', 'Não'],
      Categoria: [
        'Pessoa Física', 'Empresário', 'Deputado', 'Senador',
        'Vereador', 'Prefeito', 'Secretário', 'Político',
        'Médico', 'Corpo Clínico', 'Fornecedor', 'Parceiro',
        'Patrocinador', 'Imprensa', 'Doador', 'Conselheiro',
        'Instituição', 'Outro'
      ]
    }
  },

  EMPRESAS: {
    nome: 'Empresas',
    prefixoId: 'E',
    colunas: [
      'ID_Empresa', 'Nome', 'Segmento', 'Cidade', 'UF',
      'Contato', 'Telefone', 'Website', 'Observacoes', 'Criado_Em'
    ],
    validacoes: {}
  },

  GESTORES: {
    nome: 'Gestores',
    prefixoId: 'G',
    colunas: [
      'ID_Gestor', 'Nome', 'Setor', 'Perfil', 'Senha_Hash',
      'Cargo', 'Ativo', 'Criado_Em'
    ],
    validacoes: {
      Ativo: ['Sim', 'Não'],
      Perfil: ['Admin', 'Organizacao', 'Recepcao', 'Consulta']
    }
  },

  CONVITES: {
    nome: 'Convites',
    prefixoId: 'C',
    colunas: [
      'ID_Convite', 'ID_Evento', 'ID_Pessoa', 'ID_Lote',
      'Gestor', 'Status', 'Origem',
      'ID_Convite_Original', 'Motivo_Substituicao', 'Autorizado_Por',
      'QR_Token', 'QR_Valido',
      'Data_Convite', 'Data_Resposta',
      'Checkin_DataHora', 'Checkin_Por',
      'Observacoes', 'Cadastrado_Por'
    ],
    validacoes: {
      Status: [
        'Convidado', 'Confirmado', 'Recusado', 'Sem resposta',
        'Presente', 'Ausente', 'Substituído', 'Cancelado'
      ],
      Origem: ['Lista original', 'Substituição', 'Walk-in', 'Lote público'],
      QR_Valido: ['Sim', 'Não']
    }
  },

  LOTES: {
    nome: 'Lotes',
    prefixoId: 'LT',
    colunas: [
      'ID_Lote', 'ID_Evento', 'ID_Empresa', 'Gestor',
      'Token', 'Vagas_Total', 'Status',
      'Data_Expiracao', 'Observacoes', 'Criado_Em'
    ],
    validacoes: {
      Status: ['Aberto', 'Encerrado', 'Expirado']
    }
  },

  MESAS: {
    nome: 'Mesas',
    prefixoId: 'M',
    colunas: [
      'ID_Mesa', 'ID_Evento', 'Numero', 'Capacidade', 'VIP', 'Pos_X', 'Pos_Y'
    ],
    validacoes: { VIP: ['Sim', 'Não'] }
  },

  CATEGORIAS: {
    nome: 'Categorias',
    prefixoId: 'CAT',
    colunas: ['ID_Categoria', 'Nome', 'Tipo'],
    validacoes: {}
  },

  ACOMPANHANTES: {
    nome: 'Acompanhantes',
    prefixoId: 'AC',
    colunas: [
      'ID_Acompanhante', 'ID_Convite_Principal',
      'Nome', 'Telefone', 'Checkin_DataHora'
    ],
    validacoes: {}
  },

  RESTRICOES: {
    nome: 'Restricoes',
    prefixoId: 'R',
    colunas: ['ID_Restricao', 'ID_Convite', 'Tipo', 'Descricao'],
    validacoes: {}
  },

  EMAIL_LOGS: {
    nome: 'EmailLogs',
    prefixoId: 'ML',
    colunas: ['ID_Email', 'ID_Convite', 'Enviado_Em', 'Tipo', 'Status'],
    validacoes: {
      Tipo: ['Convite', 'Lembrete', 'Agradecimento', 'Confirmacao'],
      Status: ['Enviado', 'Erro']
    }
  },

  AUDIT_LOG: {
    nome: 'AuditLog',
    prefixoId: 'AL',
    colunas: [
      'ID_Log', 'ID_Gestor', 'Timestamp', 'Acao',
      'Tabela', 'ID_Registro', 'Valor_Antigo', 'Valor_Novo'
    ],
    validacoes: {}
  },

  CONFIG: {
    nome: 'Config',
    prefixoId: 'CFG',
    colunas: ['Chave', 'Valor', 'Atualizado_Em'],
    validacoes: {}
  }
};

// ------------------------------------------------------------
// PLANILHA — auto-provisionada na primeira execução.
// Este é um script standalone (não vinculado a uma planilha), então
// SpreadsheetApp.getActiveSpreadsheet() sempre retorna null aqui.
// Guardamos o ID real em Script Properties na primeira vez que alguém
// usa o sistema: se CONFIG.SPREADSHEET_ID (Config.js) já tiver um ID
// válido, usamos ele; senão criamos uma planilha nova automaticamente.
// ------------------------------------------------------------
function _getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const idSalvo = props.getProperty('SPREADSHEET_ID');
  if (idSalvo) {
    try { return SpreadsheetApp.openById(idSalvo); } catch (e) { /* ID salvo não existe mais — recria abaixo */ }
  }
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== 'SEU_ID_DA_PLANILHA_AQUI') {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      props.setProperty('SPREADSHEET_ID', CONFIG.SPREADSHEET_ID);
      return ss;
    } catch (e) { /* ID fixo inválido — cai para criar uma nova planilha */ }
  }
  const nova = SpreadsheetApp.create(CONFIG.APP_NAME + ' — Banco de Dados');
  props.setProperty('SPREADSHEET_ID', nova.getId());
  Logger.log('📄 Planilha criada automaticamente: ' + nova.getUrl());
  return nova;
}

// ------------------------------------------------------------
// SETUP DO BANCO (idempotente) — garante todas as abas de uma vez.
// Chamado automaticamente sob demanda por _getAba(); pode também ser
// executado manualmente no editor do Apps Script se quiser forçar.
// ------------------------------------------------------------
function setupDatabase() {
  const ss = _getSpreadsheet();
  Object.values(DB).forEach(schema => _garantirAba(ss, schema));

  ['Página1', 'Sheet1', 'Plan1'].forEach(nome => {
    const aba = ss.getSheetByName(nome);
    if (aba && aba.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(aba);
  });

  Logger.log('✅ setupDatabase() concluído com sucesso.');
}

function _garantirAba(ss, schema) {
  let aba = ss.getSheetByName(schema.nome);
  if (aba) return aba;

  aba = ss.insertSheet(schema.nome);
  const header = aba.getRange(1, 1, 1, schema.colunas.length);
  header.setValues([schema.colunas]);
  header.setFontWeight('bold').setBackground('#041D56').setFontColor('#FFFFFF');
  aba.setFrozenRows(1);

  Object.keys(schema.validacoes).forEach(nomeColuna => {
    const idx = schema.colunas.indexOf(nomeColuna);
    if (idx === -1) return;
    const regra = SpreadsheetApp.newDataValidation()
      .requireValueInList(schema.validacoes[nomeColuna], true)
      .setAllowInvalid(false).build();
    aba.getRange(2, idx + 1, 5000, 1).setDataValidation(regra);
  });

  aba.autoResizeColumns(1, schema.colunas.length);
  return aba;
}

// ------------------------------------------------------------
// GERAÇÃO DE IDs com LockService (seguro para uso simultâneo)
// ------------------------------------------------------------
function gerarId(schema) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const chave = 'SEQ_' + schema.prefixoId;
    const atual = Number(props.getProperty(chave) || 0) + 1;
    props.setProperty(chave, String(atual));
    return schema.prefixoId + '-' + String(atual).padStart(5, '0');
  } finally {
    lock.releaseLock();
  }
}

// Compatibilidade com código legado
function generateRecordId() { return Utilities.getUuid(); }
function generateUUID()     { return Utilities.getUuid(); }

// ------------------------------------------------------------
// FUNÇÕES INTERNAS
// ------------------------------------------------------------
function _getAba(schema) {
  return _garantirAba(_getSpreadsheet(), schema);
}

function _linhaParaObjeto(schema, linha) {
  const obj = {};
  schema.colunas.forEach((col, i) => obj[col] = linha[i]);
  return obj;
}

function _objetoParaLinha(schema, obj) {
  return schema.colunas.map(col => obj[col] !== undefined ? obj[col] : '');
}

// ------------------------------------------------------------
// CACHE COM VERSIONAMENTO
// ------------------------------------------------------------
function _versaoTabela(schema) {
  return Number(PropertiesService.getScriptProperties()
    .getProperty('VER_' + schema.nome) || 0);
}

function _bumpVersao(schema) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('VER_' + schema.nome, String(_versaoTabela(schema) + 1));
}

function _lerTabelaComCache(schema) {
  const cache = CacheService.getScriptCache();
  const chave = 'tab_' + schema.nome + '_' + _versaoTabela(schema);
  const raw = cache.get(chave);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  const aba = _getAba(schema);
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return [];
  const dados = aba.getRange(2, 1, ultimaLinha - 1, schema.colunas.length).getValues();
  const objetos = dados.map(linha => _linhaParaObjeto(schema, linha));
  try { cache.put(chave, JSON.stringify(objetos), 300); } catch (e) {}
  return objetos;
}

// ------------------------------------------------------------
// CRUD GENÉRICO
// ------------------------------------------------------------
function dbInserir(schema, dados) {
  const colunaId = schema.colunas[0];
  if (!dados[colunaId]) dados[colunaId] = gerarId(schema);
  const aba = _getAba(schema);
  aba.appendRow(_objetoParaLinha(schema, dados));
  _bumpVersao(schema);
  return dados;
}

function dbListar(schema, filtro) {
  const objetos = _lerTabelaComCache(schema);
  return filtro ? objetos.filter(filtro) : objetos;
}

function dbBuscarPorId(schema, id) {
  const colunaId = schema.colunas[0];
  const resultado = dbListar(schema, r => r[colunaId] === id);
  return resultado.length ? resultado[0] : null;
}

function dbAtualizar(schema, id, novosDados) {
  const aba = _getAba(schema);
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return null;
  const colunaIds = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  for (let i = 0; i < colunaIds.length; i++) {
    if (colunaIds[i][0] === id) {
      const numLinha = i + 2;
      const linhaAtual = aba.getRange(numLinha, 1, 1, schema.colunas.length).getValues()[0];
      const registro = _linhaParaObjeto(schema, linhaAtual);
      Object.keys(novosDados).forEach(campo => {
        if (schema.colunas.indexOf(campo) !== -1) registro[campo] = novosDados[campo];
      });
      aba.getRange(numLinha, 1, 1, schema.colunas.length).setValues([_objetoParaLinha(schema, registro)]);
      _bumpVersao(schema);
      return registro;
    }
  }
  return null;
}

function dbExcluir(schema, id) {
  const aba = _getAba(schema);
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return false;
  const colunaIds = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  for (let i = 0; i < colunaIds.length; i++) {
    if (colunaIds[i][0] === id) {
      aba.deleteRow(i + 2);
      _bumpVersao(schema);
      return true;
    }
  }
  return false;
}

function dbBuscarPor(schema, campo, valor) {
  return dbListar(schema, r => r[campo] === valor);
}

function dbContar(schema, filtro) {
  return dbListar(schema, filtro).length;
}
