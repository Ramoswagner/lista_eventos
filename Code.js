/**
 * ============================================================
 * CODE.GS - Entry point e API do sistema de eventos HB
 * ============================================================
 * Padrão de resposta: { ok: true, dados: ... } ou { ok: false, mensagem: ... }
 * Sessão expirada: { ok: false, auth: false, mensagem: '...' }
 * ============================================================
 */

// Resposta padrão para sessão inválida
const NEGADO = { ok: false, auth: false, mensagem: 'Sessão expirada. Entre novamente.' };

// Mapeamento de rotas para arquivos HTML
// Nível 1 (global) + Nível 2 (dentro de um evento, prefixo "evento-")
const VIEW_MAP = {
  'eventos':        'EventosHub',      // lista de eventos + criar (tela inicial)
  'diretorio':      'GuestsList',      // CRM global: pessoas & empresas
  'evento-visao':   'EventoVisaoGeral',// dashboard do evento
  'evento-lista':   'EventoLista',     // lista de convidados + convites/lotes
  'evento-checkin': 'CheckinScanner',  // check-in do evento
  'evento-mesas':   'EventoMesas',     // mapa de mesas do evento
  'evento-relatorios': 'Relatorios',   // relatórios de um evento
  'relatorios':     'Relatorios',      // panorama / comparativo de vários eventos
  'config':         'ConfigPainel'     // gestão de logins
};

// Tokens públicos (lote e convite) são UUIDs. Qualquer outra coisa na URL
// é descartada antes de chegar ao template.
function _tokenPublicoValido_(t) { return /^[A-Za-z0-9-]{8,64}$/.test(_s_(t)); }

// Lança erro se o perfil logado não pode fazer a ação (matriz PERMISSOES em Auth.js).
function _exigirPermissao_(s, modulo, acao) {
  if (!temPermissao_(s.perfil, modulo, acao)) {
    throw new Error('Seu perfil (' + s.perfil + ') não tem permissão para esta ação.');
  }
}

// ------------------------------------------------------------
// ENTRY POINT
// ------------------------------------------------------------
function doGet(e) {
  const pagina = (e && e.parameter && e.parameter.pagina) || 'app';
  const token  = (e && e.parameter && e.parameter.token)  || '';

  // Tela pública de lote (sem login) — empresa se inscreve num lote com vagas
  if (pagina === 'convite' && token) {
    const tpl = HtmlService.createTemplateFromFile('ConvitePublico');
    tpl.loteToken = _tokenPublicoValido_(token) ? token : '';
    return tpl.evaluate()
      .setTitle('Inscrição — Eventos Hospital da Baleia')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Tela pública de confirmação individual (sem login) — qualquer convidado
  // (manual, lote ou substituição) confirma/recusa presença pelo próprio link
  if (pagina === 'confirmar' && token) {
    const tpl = HtmlService.createTemplateFromFile('ConfirmarPresenca');
    tpl.qrToken = _tokenPublicoValido_(token) ? token : '';
    return tpl.evaluate()
      .setTitle('Confirmar presença — Eventos Hospital da Baleia')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // App principal — o login é feito dentro do próprio Index.html (gate via apiLogin),
  // sem depender de sessão de servidor no carregamento da página.
  const output = HtmlService.createTemplateFromFile('Index');

  return output.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setFaviconUrl('https://cdn-icons-png.flaticon.com/512/3135/3135715.png');
}

// Serve views via AJAX
function getViewContent(viewName) {
  const fileName = VIEW_MAP[viewName];
  if (!fileName) {
    return '<div class="alert alert-danger">Página não encontrada.</div>';
  }
  try {
    return HtmlService.createHtmlOutputFromFile(fileName).getContent();
  } catch (e) {
    return '<div class="alert alert-danger">Erro ao carregar a tela.</div>';
  }
}

// ------------------------------------------------------------
// ENDEREÇO PÚBLICO DOS LINKS (lote e confirmação)
// Os links nunca ficam gravados na planilha: são montados na hora a
// partir do token + este endereço. Então, se o endereço mudar, basta
// ajustar aqui (ou em Configurações) e todos os links voltam a valer.
//  1. Se o Admin fixou um endereço em Configurações, usa ele.
//  2. Senão usa o da implantação atual, trocando /dev por /exec
//     (/dev só abre para editores do script — convidado veria erro).
// ------------------------------------------------------------
let _urlBaseMemo_ = null;
function _urlBase_() {
  if (_urlBaseMemo_) return _urlBaseMemo_;
  _urlBaseMemo_ = _calcularUrlBase_();
  return _urlBaseMemo_;
}

function _calcularUrlBase_() {
  const fixa = _s_(_configObter_('URL_PUBLICA', ''));
  if (fixa) return fixa;
  return _s_(ScriptApp.getService().getUrl()).replace(/\/dev$/, '/exec');
}

function _urlPublicaValida_(url) {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
}

function apiObterUrlPublica(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const fixa = _s_(_configObter_('URL_PUBLICA', ''));
  const detectada = _s_(ScriptApp.getService().getUrl());
  return { ok: true, dados: {
    atual: _urlBase_(),
    fixa: fixa,
    detectada: detectada,
    avisoDev: /\/dev$/.test(detectada) && !fixa
  } };
}

// url vazia = volta a usar a detecção automática.
function apiSalvarUrlPublica(token, url) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera o endereço dos links.' };
    const limpa = _s_(url).replace(/\?.*$/, '').replace(/\/dev$/, '/exec');
    if (limpa && !_urlPublicaValida_(limpa)) {
      throw new Error('Endereço inválido. Use o "URL do app da Web" da implantação, terminado em /exec.');
    }
    if (limpa) _configSalvar_('URL_PUBLICA', limpa);
    else if (_configObter_('URL_PUBLICA', '')) dbExcluir_(DB.CONFIG, 'URL_PUBLICA');
    _urlBaseMemo_ = null;
    return { ok: true, mensagem: limpa ? 'Endereço dos links salvo.' : 'Voltou para o endereço automático.', dados: { atual: _urlBase_() } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}
function _linkConfirmacao_(qrToken, urlBase) {
  return qrToken ? (urlBase || _urlBase_()) + '?pagina=confirmar&token=' + qrToken : '';
}

// ------------------------------------------------------------
// BOOTSTRAP (tudo em uma chamada só)
// ------------------------------------------------------------
function apiBootstrapGestao(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: {
    pessoas:  apiListarPessoas(token).dados   || [],
    empresas: apiListarEmpresas(token).dados  || [],
    gestores: apiListarGestoresNomes(token).dados || [],
    eventos:  apiListarEventosTodos(token).dados  || []
  } };
}

// Uma chamada só para abrir a tela "Lista & Convites" de um evento
// (em vez de 4 chamadas separadas: convidados, lotes, empresas, gestores).
function apiBootstrapEvento(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: {
    convidados: apiListaConvidados(token, idEvento).dados     || [],
    lotes:      apiListarLotes(token, idEvento).dados          || [],
    empresas:   apiListarEmpresas(token).dados                 || [],
    gestores:   apiListarGestoresNomes(token).dados             || [],
    vagas:      _vagasEvento_(idEvento),
    perfil:     s.perfil,
    permissoes: _permissoesDoPerfil_(s.perfil)
  } };
}

// Dados da sessão atual (nome, perfil e o que pode fazer) — a tela
// chama ao entrar para mostrar/esconder botões conforme as permissões.
function apiSessaoAtual(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: { gestor: s.gestor, setor: s.setor, perfil: s.perfil, permissoes: _permissoesDoPerfil_(s.perfil) } };
}

// ------------------------------------------------------------
// EVENTOS
// ------------------------------------------------------------
function _eventoParaCliente_(e) {
  return {
    id:          e.ID_Evento,
    nome:        _s_(e.Nome),
    data:        _fmtData_(e.Data),
    dataISO:     _fmtData_(e.Data, 'yyyy-MM-dd'),
    local:       _s_(e.Local),
    status:      _s_(e.Status),
    capacidade:  Number(e.Capacidade) || 0,
    observacoes: _s_(e.Observacoes)
  };
}

function apiListarEventos(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar_(DB.EVENTOS, e => e.Status !== 'Encerrado').map(_eventoParaCliente_) };
}

function apiListarEventosTodos(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar_(DB.EVENTOS).map(_eventoParaCliente_) };
}

function _dadosEvento_(dados, atual) {
  const status = _s_(dados.Status) || (atual ? atual.Status : 'Planejamento');
  if (DB.EVENTOS.validacoes.Status.indexOf(status) === -1) throw new Error('Status inválido.');
  const cap = _s_(dados.Capacidade);
  if (cap && (isNaN(Number(cap)) || Number(cap) < 0)) throw new Error('Capacidade inválida.');
  const novos = {
    Nome:        _s_(dados.Nome),
    Local:       _s_(dados.Local),
    Status:      status,
    Capacidade:  cap ? Number(cap) : '',
    Observacoes: _s_(dados.Observacoes)
  };
  novos.Data = dados.Data ? _parseDataLocal_(dados.Data) : '';
  return novos;
}

function apiCadastrarEvento(token, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'eventos', 'criar');
    if (!dados || !_s_(dados.Nome)) throw new Error('Nome do evento é obrigatório.');
    const novo = _dadosEvento_(dados, null);
    novo.Criado_Em = new Date();
    const ev = dbInserir_(DB.EVENTOS, novo);
    logAudit_('INSERT', 'Eventos', ev.ID_Evento, 'Evento criado por ' + rotuloSessao_(s));
    return { ok: true, mensagem: 'Evento criado.', dados: { id: ev.ID_Evento } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiEditarEvento(token, idEvento, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'eventos', 'editar');
    const ev = dbBuscarPorId_(DB.EVENTOS, idEvento);
    if (!ev) throw new Error('Evento não encontrado.');
    if (!dados || !_s_(dados.Nome)) throw new Error('Nome é obrigatório.');
    dbAtualizar_(DB.EVENTOS, idEvento, _dadosEvento_(dados, ev));
    logAudit_('UPDATE', 'Eventos', idEvento, 'Evento editado por ' + rotuloSessao_(s));
    return { ok: true, mensagem: 'Evento atualizado.', dados: { id: idEvento } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiExcluirEvento(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'eventos', 'excluir');
    return _comLock_(function() {
      const ev = dbBuscarPorId_(DB.EVENTOS, idEvento);
      if (!ev) throw new Error('Evento não encontrado.');
      const nConvites = dbExcluirVarios_(DB.CONVITES, c => _s_(c.ID_Evento) === idEvento);
      dbExcluirVarios_(DB.LOTES, l => _s_(l.ID_Evento) === idEvento);
      dbExcluir_(DB.EVENTOS, idEvento);
      logAudit_('DELETE', 'Eventos', idEvento, 'Evento excluído por ' + rotuloSessao_(s));
      return { ok: true, mensagem: 'Evento "' + ev.Nome + '" excluído com ' + nConvites + ' convite(s).' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// PESSOAS
// ------------------------------------------------------------
function apiListarPessoas(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const empresas = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
  return { ok: true, dados: dbListar_(DB.PESSOAS).map(p => ({
    id:         p.ID_Pessoa,
    nome:       _s_(p.Nome),
    documento:  _s_(p.Documento),
    telefone:   _s_(p.Telefone),
    email:      _s_(p.Email),
    cargo:      _s_(p.Cargo),
    categoria:  _s_(p.Categoria),
    empresa:    _s_(empresas[p.ID_Empresa]),
    idEmpresa:  _s_(p.ID_Empresa),
    cidade:     _s_(p.Cidade) + (p.UF ? '/' + _s_(p.UF) : ''),
    ativo:      _s_(p.Ativo) || 'Sim'
  })) };
}

// Procura pessoa já cadastrada com o mesmo documento (só dígitos).
function _pessoaPorDocumento_(documento) {
  const doc = _soDigitos_(documento);
  if (!doc) return null;
  return dbListar_(DB.PESSOAS, p => _soDigitos_(p.Documento) === doc)[0] || null;
}

function _categoriaValida_(c) {
  return DB.PESSOAS.validacoes.Categoria.indexOf(c) !== -1 ? c : 'Outro';
}

function apiCadastrarPessoa(token, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'pessoas', 'criar');
    if (!dados || !_s_(dados.Nome)) throw new Error('Nome é obrigatório.');
    return _comLock_(function() {
      const existente = _pessoaPorDocumento_(dados.Documento);
      if (existente) throw new Error('Já existe uma pessoa com este documento: ' + existente.Nome + '.');
      const p = dbInserir_(DB.PESSOAS, {
        Nome: _s_(dados.Nome), Documento: _s_(dados.Documento),
        Telefone: _s_(dados.Telefone), Email: _s_(dados.Email),
        ID_Empresa: _s_(dados.ID_Empresa), Cargo: _s_(dados.Cargo),
        Cidade: _s_(dados.Cidade), UF: _s_(dados.UF).toUpperCase(),
        Categoria: _categoriaValida_(_s_(dados.Categoria)),
        Data_Cadastro: new Date(), Ativo: 'Sim'
      });
      return { ok: true, mensagem: 'Pessoa cadastrada.', dados: { id: p.ID_Pessoa } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// EMPRESAS
// ------------------------------------------------------------
function apiListarEmpresas(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar_(DB.EMPRESAS).map(e => ({
    id:       e.ID_Empresa,
    nome:     _s_(e.Nome),
    segmento: _s_(e.Segmento),
    cidade:   _s_(e.Cidade) + (e.UF ? '/' + _s_(e.UF) : ''),
    contato:  _s_(e.Contato)
  })) };
}

function apiCadastrarEmpresa(token, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'empresas', 'criar');
    if (!dados || !_s_(dados.Nome)) throw new Error('Nome da empresa é obrigatório.');
    const e = dbInserir_(DB.EMPRESAS, {
      Nome: _s_(dados.Nome), Segmento: _s_(dados.Segmento), Contato: _s_(dados.Contato),
      Cidade: _s_(dados.Cidade), UF: _s_(dados.UF).toUpperCase(),
      Telefone: _s_(dados.Telefone), Website: _s_(dados.Website),
      Criado_Em: new Date()
    });
    return { ok: true, mensagem: 'Empresa cadastrada.', dados: { id: e.ID_Empresa } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CONVITES
// ------------------------------------------------------------
function apiListaConvidados(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;

  const pessoas  = {};
  const empresas = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e);

  const convites = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento);
  const substitutoDe = {};
  convites.forEach(c => { if (c.ID_Convite_Original) substitutoDe[c.ID_Convite_Original] = c; });
  const mesas = _rotulosMesas_(idEvento);

  const urlBase = _urlBase_();
  return { ok: true, dados: convites.map(c => {
    const p    = pessoas[c.ID_Pessoa]   || {};
    const emp  = empresas[p.ID_Empresa] || {};
    const sub  = substitutoDe[c.ID_Convite];
    const pSub = sub ? (pessoas[sub.ID_Pessoa] || {}) : null;
    return {
      idConvite:        c.ID_Convite,
      nome:             _s_(p.Nome) || '(pessoa não encontrada)',
      documento:        _s_(p.Documento),
      categoria:        _s_(p.Categoria),
      empresa:          _s_(emp.Nome),
      cargo:            _s_(p.Cargo),
      cidade:           _s_(p.Cidade) + (p.UF ? '/' + _s_(p.UF) : ''),
      gestor:           _s_(c.Gestor),
      status:           _s_(c.Status),
      origem:           _s_(c.Origem),
      linkConfirmacao:  c.QR_Valido === 'Sim' ? _linkConfirmacao_(c.QR_Token, urlBase) : '',
      checkinHora:      _fmtData_(c.Checkin_DataHora, 'HH:mm'),
      substituidoPor:   pSub ? _s_(pSub.Nome) : '',
      idLote:           _s_(c.ID_Lote),
      descricao:        _s_(c.Observacoes),
      mesa:             _ocupaLugar_(c) ? _s_(mesas[c.ID_Mesa]) : ''
    };
  }) };
}

function apiAdicionarNaLista(token, gestor, pessoa) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'convites', 'criar');
    const idEvento = pessoa && pessoa.idEvento;
    if (!idEvento) throw new Error('Evento não informado.');
    // O gestor responsável é sempre quem está logado.
    const gestorFinal = _s_(s.gestor) || _s_(gestor);
    if (!gestorFinal) throw new Error('Informe o gestor responsável.');

    return _comLock_(function() {
      const vg = _vagasEvento_(idEvento);
      if (vg.disponiveis !== null && vg.disponiveis < 1) {
        throw new Error('Capacidade do evento atingida (' + vg.ativos + ' de ' + vg.capacidade + '). Aumente a capacidade do evento para continuar.');
      }

      let idPessoa = pessoa.idPessoa;
      let reaproveitada = null;

      if (!idPessoa) {
        if (!pessoa.dados || !_s_(pessoa.dados.Nome)) throw new Error('Informe o nome.');
        const igual = _pessoaPorDocumento_(pessoa.dados.Documento);
        if (igual) { idPessoa = igual.ID_Pessoa; reaproveitada = igual.Nome; }
        if (!idPessoa) {
          const nova = dbInserir_(DB.PESSOAS, {
            Nome: _s_(pessoa.dados.Nome), Documento: _s_(pessoa.dados.Documento),
            Categoria: _categoriaValida_(_s_(pessoa.dados.Categoria)), ID_Empresa: _s_(pessoa.dados.ID_Empresa),
            Cargo: _s_(pessoa.dados.Cargo), Data_Cadastro: new Date(), Ativo: 'Sim'
          });
          idPessoa = nova.ID_Pessoa;
        }
      }

      // Descrição/observação vai na coluna própria (Observacoes) do convite.
      const c = convidarPessoa_(idEvento, idPessoa, gestorFinal, null, _s_(pessoa.descricao));
      dbAtualizar_(DB.CONVITES, c.ID_Convite, { Cadastrado_Por: rotuloSessao_(s) });

      const msg = reaproveitada
        ? 'Documento já cadastrado como "' + reaproveitada + '": pessoa reaproveitada.'
        : 'Adicionado à lista.';
      return { ok: true, mensagem: msg, dados: {
        idConvite:       c.ID_Convite,
        linkConfirmacao: _linkConfirmacao_(c.QR_Token)
      }};
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiCancelarConvite(token, idConvite) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'convites', 'excluir');
    return _comLock_(function() {
      const c = dbBuscarPorId_(DB.CONVITES, idConvite);
      if (!c) throw new Error('Convite não encontrado.');
      if (c.Status === 'Presente')  throw new Error('Convidado já fez check-in; não é possível cancelar.');
      if (c.Status === 'Cancelado') throw new Error('Este convite já está cancelado.');
      if (c.Status === 'Substituído') throw new Error('Este convite já foi substituído.');
      const marca = 'Cancelado por ' + rotuloSessao_(s) + ' em ' + _fmtData_(new Date(), 'dd/MM/yyyy HH:mm');
      dbAtualizar_(DB.CONVITES, idConvite, {
        Status: 'Cancelado',
        QR_Valido: 'Não',
        Observacoes: (c.Observacoes ? _s_(c.Observacoes) + ' | ' : '') + marca
      });
      return { ok: true, mensagem: 'Convite cancelado.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CHECK-IN
// ------------------------------------------------------------
function apiCheckin(token, idConvite) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'checkin', 'criar');
    return _comLock_(function() {
      const convite = dbBuscarPorId_(DB.CONVITES, idConvite);
      if (!convite) throw new Error('Convite não encontrado.');
      _validarJanela_(convite.ID_Evento, s);
      fazerCheckin_(idConvite, rotuloSessao_(s));
      const mesa = _s_(_rotulosMesas_(convite.ID_Evento)[convite.ID_Mesa]);
      return { ok: true, mensagem: 'Entrada confirmada.' + (mesa ? ' ' + mesa + '.' : ''), dados: { mesa: mesa } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// idEvento: evento aberto na tela de check-in — QR de outro evento é recusado.
function apiCheckinQR(token, qrToken, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'checkin', 'criar');
    return _comLock_(function() {
      const convite = fazerCheckinPorQR_(qrToken, rotuloSessao_(s), idEvento, s);
      const pessoa  = dbBuscarPorId_(DB.PESSOAS, convite.ID_Pessoa);
      const nome    = pessoa ? _s_(pessoa.Nome) : '';
      const mesa    = _s_(_rotulosMesas_(convite.ID_Evento)[convite.ID_Mesa]);
      return { ok: true, mensagem: 'Bem-vindo(a), ' + nome + '!' + (mesa ? ' ' + mesa + '.' : ''), dados: { nome: nome, mesa: mesa } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiWalkin(token, idEvento, nome, categoria, autorizadoPor) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'checkin', 'criar');
    if (!_s_(nome)) throw new Error('Informe o nome.');
    if (!_s_(autorizadoPor)) throw new Error('Informe quem autorizou.');
    return _comLock_(function() {
      _validarJanela_(idEvento, s);
      registrarWalkin_(idEvento, {
        dadosNovaPessoa: { Nome: _s_(nome), Categoria: _categoriaValida_(_s_(categoria)) },
        autorizadoPor:   _s_(autorizadoPor),
        checkinPor:      rotuloSessao_(s)
      });
      return { ok: true, mensagem: 'Walk-in registrado. ' + _s_(nome) + ' está presente.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiSubstituirEEntrar(token, idConviteOriginal, nomeSubstituto, categoria, motivo, autorizadoPor) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'checkin', 'criar');
    if (!_s_(nomeSubstituto)) throw new Error('Informe o nome de quem vai entrar.');
    if (!_s_(autorizadoPor)) throw new Error('Informe quem autorizou.');
    return _comLock_(function() {
      const original = dbBuscarPorId_(DB.CONVITES, idConviteOriginal);
      if (!original) throw new Error('Convite original não encontrado.');
      _validarJanela_(original.ID_Evento, s);
      const nova = dbInserir_(DB.PESSOAS, {
        Nome: _s_(nomeSubstituto), Categoria: _categoriaValida_(_s_(categoria)),
        Data_Cadastro: new Date(), Ativo: 'Sim'
      });
      const novoConvite = substituirConvidado_(idConviteOriginal, nova.ID_Pessoa, _s_(motivo), _s_(autorizadoPor));
      fazerCheckin_(novoConvite.ID_Convite, rotuloSessao_(s));
      return { ok: true, mensagem: 'Substituição registrada. ' + _s_(nomeSubstituto) + ' está presente.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
function apiDashboardEvento(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };

  const resumo   = resumoEvento_(idEvento);
  const pessoas  = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  const convites = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento);

  const porCategoria = {};
  const porGestor    = {};
  const checkinsPorHora = {};

  convites.forEach(c => {
    if (c.Status === 'Cancelado' || c.Status === 'Substituído') return;
    const p   = pessoas[c.ID_Pessoa] || {};
    const cat = _s_(p.Categoria) || 'Outro';
    porCategoria[cat] = (porCategoria[cat] || 0) + 1;
    if (c.Gestor) porGestor[c.Gestor] = (porGestor[c.Gestor] || 0) + 1;
    if (c.Status === 'Presente' && c.Checkin_DataHora) {
      const hora = _fmtData_(c.Checkin_DataHora, 'H') + ':00';
      if (hora !== ':00') checkinsPorHora[hora] = (checkinsPorHora[hora] || 0) + 1;
    }
  });

  const topGestores = Object.keys(porGestor)
    .map(g => ({ gestor: g, total: porGestor[g] }))
    .sort((a, b) => b.total - a.total).slice(0, 6);

  return { ok: true, dados: {
    evento: { id: evento.ID_Evento, nome: _s_(evento.Nome),
              data: _fmtData_(evento.Data),
              capacidade: Number(evento.Capacidade) || 0 },
    resumo, porCategoria, topGestores, checkinsPorHora
  } };
}

function apiInfoCheckin(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };
  const j = janelaEvento_(evento);
  return { ok: true, dados: {
    janela: j.janela, mensagem: j.mensagem, dataFmt: j.dataFmt,
    admin: s.perfil === 'Admin',
    podeCheckin: temPermissao_(s.perfil, 'checkin', 'criar')
  } };
}

function apiDadosCheckin(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const info  = apiInfoCheckin(token, idEvento);
  const lista = apiListaConvidados(token, idEvento);
  if (!info.ok)  return info;
  if (!lista.ok) return lista;
  return { ok: true, dados: { info: info.dados, convidados: lista.dados } };
}

// ------------------------------------------------------------
// AUDITORIA
// ------------------------------------------------------------
function logAudit_(acao, tabela, idRegistro, descricao) {
  try {
    dbInserir_(DB.AUDIT_LOG, {
      Timestamp:  new Date(),
      Acao:       acao,
      Tabela:     tabela,
      ID_Registro: idRegistro,
      Valor_Novo:  descricao || ''
    });
  } catch (e) { Logger.log('Audit error: ' + e.message); }
}
