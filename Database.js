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
      // "Organizacao" fica na lista só para logins antigos continuarem válidos
      // (o sistema trata "Organizacao" como "Gestor").
      Perfil: ['Admin', 'Gestor', 'Organizador', 'Recepcao', 'Consulta', 'Organizacao']
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
      'Observacoes', 'Cadastrado_Por',
      'ID_Mesa'                     // mesa onde o convidado vai sentar (vazio = sem mesa)
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
      'ID_Mesa', 'ID_Evento', 'Numero', 'Capacidade', 'VIP', 'Pos_X', 'Pos_Y',
      'Nome', 'Formato', 'Observacoes'
    ],
    validacoes: { VIP: ['Sim', 'Não'], Formato: ['Redonda', 'Retangular'] }
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
// Memória da execução atual: abrir a planilha e achar abas custa caro,
// então cada chamada ao servidor faz isso uma vez só.
let _ssMemo_ = null;
const _abaMemo_ = {};

function _getSpreadsheet_() {
  if (!_ssMemo_) _ssMemo_ = _abrirSpreadsheet_();
  return _ssMemo_;
}

function _abrirSpreadsheet_() {
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
// Chamado automaticamente sob demanda por _getAba_(); pode também ser
// executado manualmente no editor do Apps Script se quiser forçar.
// ------------------------------------------------------------
function setupDatabase() {
  _somenteEditor_();
  const ss = _getSpreadsheet_();
  Object.values(DB).forEach(schema => _garantirAba_(ss, schema));

  ['Página1', 'Sheet1', 'Plan1'].forEach(nome => {
    const aba = ss.getSheetByName(nome);
    if (aba && aba.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(aba);
  });

  Logger.log('✅ setupDatabase() concluído com sucesso.');
}

// Versão das listas de validação (ex.: perfis aceitos). Quando muda,
// as abas que já existiam recebem as listas novas uma única vez.
const VALIDACOES_VERSAO = '3';

function _garantirAba_(ss, schema) {
  let aba = ss.getSheetByName(schema.nome);
  if (aba) {
    _garantirCabecalho_(aba, schema);
    _atualizarValidacoesSePreciso_(aba, schema);
    return aba;
  }

  aba = ss.insertSheet(schema.nome);
  PropertiesService.getScriptProperties().setProperty('COLS_' + schema.nome, String(schema.colunas.length));
  const header = aba.getRange(1, 1, 1, schema.colunas.length);
  header.setValues([schema.colunas]);
  header.setFontWeight('bold').setBackground('#041D56').setFontColor('#FFFFFF');
  aba.setFrozenRows(1);
  _aplicarValidacoes_(aba, schema);
  PropertiesService.getScriptProperties().setProperty('VALID_' + schema.nome, VALIDACOES_VERSAO);

  aba.autoResizeColumns(1, schema.colunas.length);
  return aba;
}

// Colunas novas no schema (ex.: ID_Mesa) entram no fim da aba que já
// existia: só o cabeçalho é escrito, os dados antigos ficam intactos.
// Guardado em Script Properties para não reler o cabeçalho a toda chamada.
function _garantirCabecalho_(aba, schema) {
  const chave = 'COLS_' + schema.nome;
  if (Number(_versaoProp_(chave) || 0) === schema.colunas.length) return;
  const atual = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1)).getValues()[0];
  schema.colunas.forEach((col, i) => {
    if (atual[i] !== col) {
      if (atual[i] && atual[i] !== col) throw new Error('A aba "' + schema.nome + '" tem a coluna ' + (i + 1) + ' como "' + atual[i] + '", mas o sistema espera "' + col + '". Corrija o cabeçalho da planilha.');
      aba.getRange(1, i + 1).setValue(col).setFontWeight('bold').setBackground('#041D56').setFontColor('#FFFFFF');
    }
  });
  PropertiesService.getScriptProperties().setProperty(chave, String(schema.colunas.length));
  if (_versoesMemo_) _versoesMemo_[chave] = String(schema.colunas.length);
}

function _aplicarValidacoes_(aba, schema) {
  Object.keys(schema.validacoes).forEach(nomeColuna => {
    const idx = schema.colunas.indexOf(nomeColuna);
    if (idx === -1) return;
    const regra = SpreadsheetApp.newDataValidation()
      .requireValueInList(schema.validacoes[nomeColuna], true)
      .setAllowInvalid(false).build();
    aba.getRange(2, idx + 1, Math.max(5000, aba.getMaxRows() - 1), 1).setDataValidation(regra);
  });
}

function _atualizarValidacoesSePreciso_(aba, schema) {
  if (!Object.keys(schema.validacoes).length) return;
  if (_versaoProp_('VALID_' + schema.nome) === VALIDACOES_VERSAO) return;
  _aplicarValidacoes_(aba, schema);
  PropertiesService.getScriptProperties().setProperty('VALID_' + schema.nome, VALIDACOES_VERSAO);
  if (_versoesMemo_) _versoesMemo_['VALID_' + schema.nome] = VALIDACOES_VERSAO;
}

// ------------------------------------------------------------
// LOCK REENTRANTE — toda escrita (e toda regra do tipo "confere e
// grava", como vagas de lote e check-in) roda dentro deste lock, para
// que duas pessoas ao mesmo tempo não estourem vagas nem gravem por
// cima uma da outra. Reentrante: chamadas aninhadas na mesma execução
// não tentam pegar o lock de novo.
// ------------------------------------------------------------
let _lockProfundidade = 0;

function _comLock_(fn) {
  if (_lockProfundidade > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema ocupado no momento. Tente novamente em alguns segundos.');
  _lockProfundidade++;
  // Com o lock na mão, descarta o que foi lido antes: outra pessoa pode
  // ter gravado nesse meio-tempo (ex.: ocupado a última vaga).
  _recarregarVersoes_();
  try {
    return fn();
  } finally {
    _lockProfundidade--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// UTILITÁRIOS DE TEXTO E DATA
// ------------------------------------------------------------
// Texto seguro: a planilha pode devolver número (ex.: CPF sem pontuação)
// onde o código espera string — String() evita "replace is not a function".
function _s_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function _soDigitos_(v) { return _s_(v).replace(/\D/g, ''); }

// "2026-10-05" (input type=date) vira meia-noite no fuso do script.
// new Date('2026-10-05') seria meia-noite UTC = 21h do dia anterior em
// São Paulo — o evento aparecia um dia antes.
function _parseDataLocal_(v, fimDoDia) {
  if (!v) return '';
  if (v instanceof Date) return v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return fimDoDia
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
      : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error('Data inválida: ' + v);
  return d;
}

function _fmtData_(v, formato) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, CONFIG.TIMEZONE, formato || 'dd/MM/yyyy');
}

// ------------------------------------------------------------
// GERAÇÃO DE IDs (sequencial, dentro do lock)
// ------------------------------------------------------------
function gerarId_(schema) {
  return _comLock_(function() {
    const props = PropertiesService.getScriptProperties();
    const chave = 'SEQ_' + schema.prefixoId;
    const atual = Number(props.getProperty(chave) || 0) + 1;
    props.setProperty(chave, String(atual));
    return schema.prefixoId + '-' + String(atual).padStart(5, '0');
  });
}

// Compatibilidade com código legado
function generateRecordId_() { return Utilities.getUuid(); }
function generateUUID_()     { return Utilities.getUuid(); }

// ------------------------------------------------------------
// FUNÇÕES INTERNAS
// ------------------------------------------------------------
function _getAba_(schema) {
  if (!_abaMemo_[schema.nome]) _abaMemo_[schema.nome] = _garantirAba_(_getSpreadsheet_(), schema);
  return _abaMemo_[schema.nome];
}

function _linhaParaObjeto_(schema, linha) {
  const obj = {};
  schema.colunas.forEach((col, i) => obj[col] = linha[i]);
  return obj;
}

// Todo texto é gravado com apóstrofo na frente, o que força a planilha a
// guardá-lo como texto puro (o apóstrofo não aparece nem volta no getValues):
//  - CPF/telefone com zero à esquerda não perdem o zero;
//  - "+55 31..." não vira fórmula com erro;
//  - nome digitado como "=IMPORTXML(...)" num formulário público não executa.
function _objetoParaLinha_(schema, obj) {
  return schema.colunas.map(col => {
    const v = obj[col];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' && v !== '') return "'" + v;
    return v;
  });
}

// ------------------------------------------------------------
// CACHE EM 3 NÍVEIS (do mais rápido para o mais lento)
//  1. Memória da execução: dentro de uma mesma chamada ao servidor,
//     cada aba é lida uma vez só (antes, abrir a lista de um evento
//     lia a aba Pessoas várias vezes).
//  2. CacheService (compartilhado entre usuários, até 6h): a aba é
//     guardada em blocos de ~90KB, então funciona com qualquer tamanho
//     (o limite do Cache é 100KB por item; antes, aba grande nunca
//     entrava no cache e toda leitura ia para a planilha).
//  3. Planilha (só quando o cache não tem a versão atual).
// Toda gravação sobe a "versão" da aba: o cache antigo deixa de ser
// usado na hora, por isso a validade longa é segura.
// ------------------------------------------------------------
const CACHE_TTL_SEG = 21600;          // 6h (máximo do CacheService)
const CACHE_BLOCO = 90 * 1024;        // caracteres por bloco
let _versoesMemo_ = null;             // Script Properties, lidas de uma vez
const _tabelaMemo_ = {};              // linhas já lidas nesta execução

function _versaoProp_(chave) {
  if (!_versoesMemo_) _versoesMemo_ = PropertiesService.getScriptProperties().getProperties();
  return _versoesMemo_[chave];
}

function _versaoTabela_(schema) {
  return Number(_versaoProp_('VER_' + schema.nome) || 0);
}

function _bumpVersao_(schema) {
  // Dentro do lock: lê o valor atual direto (não o da memória).
  const props = PropertiesService.getScriptProperties();
  const nova = Number(props.getProperty('VER_' + schema.nome) || 0) + 1;
  props.setProperty('VER_' + schema.nome, String(nova));
  if (!_versoesMemo_) _versoesMemo_ = props.getProperties();
  _versoesMemo_['VER_' + schema.nome] = String(nova);
  delete _tabelaMemo_[schema.nome];
}

// Esquece o que foi lido nesta execução (usado ao pegar o lock).
function _recarregarVersoes_() {
  _versoesMemo_ = null;
  Object.keys(_tabelaMemo_).forEach(k => delete _tabelaMemo_[k]);
}

function _cacheLer_(chave) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(chave) || 0);
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(chave + '_' + i);
  const partes = cache.getAll(chaves);
  let json = '';
  for (let i = 0; i < n; i++) {
    const p = partes[chave + '_' + i];
    if (p === undefined || p === null) return null;
    json += p;
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}

function _cacheGravar_(chave, valor) {
  try {
    const json = JSON.stringify(valor);
    const blocos = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CACHE_BLOCO) blocos[chave + '_' + (n++)] = json.substr(i, CACHE_BLOCO);
    if (n === 0 || n > 80) return;   // vazio ou enorme (>7MB): não cacheia
    const cache = CacheService.getScriptCache();
    cache.putAll(blocos, CACHE_TTL_SEG);
    cache.put(chave, String(n), CACHE_TTL_SEG);
  } catch (e) { /* cache é só otimização — falhar aqui não quebra nada */ }
}

function _lerTabelaComCache_(schema) {
  const versao = _versaoTabela_(schema);
  const memo = _tabelaMemo_[schema.nome];
  if (memo && memo.versao === versao) return memo.objetos;

  const chave = 'tab_' + schema.nome + '_' + versao;
  let linhas = _cacheLer_(chave);
  if (!linhas) {
    const aba = _getAba_(schema);
    const ultimaLinha = aba.getLastRow();
    linhas = ultimaLinha < 2 ? [] : aba.getRange(2, 1, ultimaLinha - 1, schema.colunas.length).getValues();
    // Guarda como listas (não objetos): o JSON fica bem menor.
    _cacheGravar_(chave, linhas);
  }
  const objetos = linhas.map(linha => _linhaParaObjeto_(schema, linha));
  _tabelaMemo_[schema.nome] = { versao: versao, objetos: objetos };
  return objetos;
}

// ------------------------------------------------------------
// CRUD GENÉRICO
// ------------------------------------------------------------
function dbInserir_(schema, dados) {
  return _comLock_(function() {
    const colunaId = schema.colunas[0];
    if (!dados[colunaId]) dados[colunaId] = gerarId_(schema);
    const aba = _getAba_(schema);
    aba.appendRow(_objetoParaLinha_(schema, dados));
    _bumpVersao_(schema);
    return dados;
  });
}

function dbListar_(schema, filtro) {
  const objetos = _lerTabelaComCache_(schema);
  return filtro ? objetos.filter(filtro) : objetos;
}

function dbBuscarPorId_(schema, id) {
  const colunaId = schema.colunas[0];
  const resultado = dbListar_(schema, r => r[colunaId] === id);
  return resultado.length ? resultado[0] : null;
}

function dbAtualizar_(schema, id, novosDados) {
  return _comLock_(function() {
    const aba = _getAba_(schema);
    const ultimaLinha = aba.getLastRow();
    if (ultimaLinha < 2) return null;
    const colunaIds = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
    for (let i = 0; i < colunaIds.length; i++) {
      if (_s_(colunaIds[i][0]) === _s_(id)) {
        const numLinha = i + 2;
        const linhaAtual = aba.getRange(numLinha, 1, 1, schema.colunas.length).getValues()[0];
        const registro = _linhaParaObjeto_(schema, linhaAtual);
        Object.keys(novosDados).forEach(campo => {
          if (schema.colunas.indexOf(campo) !== -1) registro[campo] = novosDados[campo];
        });
        aba.getRange(numLinha, 1, 1, schema.colunas.length).setValues([_objetoParaLinha_(schema, registro)]);
        _bumpVersao_(schema);
        return registro;
      }
    }
    return null;
  });
}

function dbExcluir_(schema, id) {
  return _comLock_(function() {
    const aba = _getAba_(schema);
    const ultimaLinha = aba.getLastRow();
    if (ultimaLinha < 2) return false;
    const colunaIds = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
    for (let i = 0; i < colunaIds.length; i++) {
      if (_s_(colunaIds[i][0]) === _s_(id)) {
        aba.deleteRow(i + 2);
        _bumpVersao_(schema);
        return true;
      }
    }
    return false;
  });
}

// Atualiza várias linhas numa passada só: { id: { campo: valor } }.
// Uma leitura + uma gravação da aba inteira (em vez de 1 por linha) —
// essencial para mover dezenas de convidados de mesa de uma vez.
function dbAtualizarVarios_(schema, mudancas) {
  const ids = Object.keys(mudancas || {});
  if (!ids.length) return 0;
  return _comLock_(function() {
    const aba = _getAba_(schema);
    const ultimaLinha = aba.getLastRow();
    if (ultimaLinha < 2) return 0;
    const range = aba.getRange(2, 1, ultimaLinha - 1, schema.colunas.length);
    const dados = range.getValues();
    let total = 0;
    const saida = dados.map(linha => {
      const id = _s_(linha[0]);
      const novos = mudancas[id];
      const registro = _linhaParaObjeto_(schema, linha);
      if (novos) {
        Object.keys(novos).forEach(campo => { if (schema.colunas.indexOf(campo) !== -1) registro[campo] = novos[campo]; });
        total++;
      }
      return _objetoParaLinha_(schema, registro);
    });
    if (total) { range.setValues(saida); _bumpVersao_(schema); }
    return total;
  });
}

// Exclui várias linhas numa passada só (de baixo pra cima, para os
// números de linha não "andarem" enquanto apaga).
function dbExcluirVarios_(schema, filtro) {
  return _comLock_(function() {
    const aba = _getAba_(schema);
    const ultimaLinha = aba.getLastRow();
    if (ultimaLinha < 2) return 0;
    const dados = aba.getRange(2, 1, ultimaLinha - 1, schema.colunas.length).getValues();
    let total = 0;
    for (let i = dados.length - 1; i >= 0; i--) {
      if (filtro(_linhaParaObjeto_(schema, dados[i]))) { aba.deleteRow(i + 2); total++; }
    }
    if (total) _bumpVersao_(schema);
    return total;
  });
}

function dbBuscarPor_(schema, campo, valor) {
  return dbListar_(schema, r => r[campo] === valor);
}

function dbContar_(schema, filtro) {
  return dbListar_(schema, filtro).length;
}
