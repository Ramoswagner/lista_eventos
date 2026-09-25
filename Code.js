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
// Participação de cada pessoa: { ID_Pessoa: { listas, presencas } }
function _participacaoPessoas_() {
  const r = {};
  dbListar_(DB.CONVITES).forEach(c => {
    const x = r[c.ID_Pessoa] = r[c.ID_Pessoa] || { listas: 0, presencas: 0 };
    if (_conviteAtivo_(c)) x.listas++;
    if (c.Status === 'Presente') x.presencas++;
  });
  return r;
}

function apiListarPessoas(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const empresas = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
  const part = _participacaoPessoas_();
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
    cidadeNome: _s_(p.Cidade),
    uf:         _s_(p.UF),
    obs:        _s_(p.Observacoes),
    gestor:     _s_(p.Gestor_Responsavel),
    listas:     (part[p.ID_Pessoa] || {}).listas || 0,
    presencas:  (part[p.ID_Pessoa] || {}).presencas || 0,
    ativo:      _s_(p.Ativo) || 'Sim'
  })) };
}

// Edição completa do cadastro (não mexe nos convites: o nome novo já
// aparece em todas as listas, porque o convite aponta para a pessoa).
function apiEditarPessoa(token, idPessoa, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'pessoas', 'editar');
    if (!dados || !_s_(dados.Nome)) throw new Error('Nome é obrigatório.');
    return _comLock_(function() {
      const p = dbBuscarPorId_(DB.PESSOAS, idPessoa);
      if (!p) throw new Error('Pessoa não encontrada.');
      const outro = _pessoaPorDocumento_(dados.Documento);
      if (outro && outro.ID_Pessoa !== idPessoa) throw new Error('Este documento já pertence a ' + outro.Nome + '.');
      const email = _s_(dados.Email).toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('E-mail inválido.');
      if (dados.ID_Empresa && !dbBuscarPorId_(DB.EMPRESAS, dados.ID_Empresa)) throw new Error('Empresa não encontrada.');
      const novos = {
        Nome: _s_(dados.Nome), Documento: _s_(dados.Documento), Telefone: _s_(dados.Telefone), Email: email,
        ID_Empresa: _s_(dados.ID_Empresa), Cargo: _s_(dados.Cargo), Cidade: _s_(dados.Cidade),
        UF: _s_(dados.UF).toUpperCase().slice(0, 2), Categoria: _categoriaValida_(_s_(dados.Categoria)),
        Observacoes: _s_(dados.Observacoes).slice(0, 300)
      };
      // Gestor responsável só muda se o perfil pode escolher (Admin / organizador sem vínculo).
      if (dados.Gestor !== undefined && (s.perfil === 'Admin' || s.perfil === 'Organizador')) novos.Gestor_Responsavel = _gestorResponsavel_(s, dados.Gestor);
      dbAtualizar_(DB.PESSOAS, idPessoa, novos);
      logAudit_('UPDATE', 'Pessoas', idPessoa, 'Cadastro editado por ' + rotuloSessao_(s));
      return { ok: true, mensagem: 'Cadastro de ' + novos.Nome + ' atualizado.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Exclui cadastro feito por engano. Nunca apaga histórico: quem já
// participou de um evento ou está em alguma lista não é excluído.
function apiExcluirPessoa(token, idPessoa) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'pessoas', 'excluir');
    return _comLock_(function() {
      const p = dbBuscarPorId_(DB.PESSOAS, idPessoa);
      if (!p) throw new Error('Pessoa não encontrada.');
      const convites = dbListar_(DB.CONVITES, c => c.ID_Pessoa === idPessoa);
      const nomeEvento = id => _s_((dbBuscarPorId_(DB.EVENTOS, id) || {}).Nome) || id;
      const participou = convites.filter(c => c.Status === 'Presente');
      if (participou.length) {
        throw new Error(_s_(p.Nome) + ' já participou de ' + nomeEvento(participou[0].ID_Evento) + (participou.length > 1 ? ' e de outros ' + (participou.length - 1) + ' evento(s)' : '') + '. O cadastro fica no histórico e não pode ser excluído.');
      }
      if (convites.length) {
        const eventos = {};
        convites.forEach(c => eventos[nomeEvento(c.ID_Evento)] = true);
        throw new Error(_s_(p.Nome) + ' ainda está na lista de: ' + Object.keys(eventos).join(', ') + '. Exclua o convite nessa(s) lista(s) antes de excluir o cadastro.');
      }
      dbExcluir_(DB.PESSOAS, idPessoa);
      logAudit_('DELETE', 'Pessoas', idPessoa, 'Cadastro "' + _s_(p.Nome) + '" excluído por ' + rotuloSessao_(s));
      return { ok: true, mensagem: 'Cadastro de ' + _s_(p.Nome) + ' excluído.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
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
        Gestor_Responsavel: _gestorResponsavel_(s, dados.Gestor),
        Telefone: _s_(dados.Telefone), Email: _s_(dados.Email).toLowerCase(),
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
  const pessoasPorEmpresa = {};
  dbListar_(DB.PESSOAS).forEach(p => { if (p.ID_Empresa) pessoasPorEmpresa[p.ID_Empresa] = (pessoasPorEmpresa[p.ID_Empresa] || 0) + 1; });
  return { ok: true, dados: dbListar_(DB.EMPRESAS).map(e => ({
    id:         e.ID_Empresa,
    nome:       _s_(e.Nome),
    cnpj:       _s_(e.CNPJ),
    segmento:   _s_(e.Segmento),
    cidade:     _s_(e.Cidade) + (e.UF ? '/' + _s_(e.UF) : ''),
    cidadeNome: _s_(e.Cidade),
    uf:         _s_(e.UF),
    contato:    _s_(e.Contato),
    telefone:   _s_(e.Telefone),
    email:      _s_(e.Email),
    website:    _s_(e.Website),
    obs:        _s_(e.Observacoes),
    pessoas:    pessoasPorEmpresa[e.ID_Empresa] || 0
  })) };
}

// CNPJ: 14 dígitos com os dois dígitos verificadores corretos.
function _cnpjValido_(cnpj) {
  const d = _soDigitos_(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = n => {
    const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const soma = pesos.reduce((t, p, i) => t + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function _formatarCnpj_(cnpj) {
  const d = _soDigitos_(cnpj);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function _dadosEmpresa_(dados, idAtual) {
  if (!dados || !_s_(dados.Nome)) throw new Error('Nome da empresa é obrigatório.');
  const cnpj = _s_(dados.CNPJ);
  if (cnpj) {
    if (!_cnpjValido_(cnpj)) throw new Error('CNPJ inválido. Confira os 14 números.');
    const igual = dbListar_(DB.EMPRESAS, e => _soDigitos_(e.CNPJ) === _soDigitos_(cnpj) && e.ID_Empresa !== idAtual)[0];
    if (igual) throw new Error('Este CNPJ já está cadastrado para ' + igual.Nome + '.');
  }
  const email = _s_(dados.Email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('E-mail inválido.');
  return {
    Nome: _s_(dados.Nome), CNPJ: cnpj ? _formatarCnpj_(cnpj) : '', Segmento: _s_(dados.Segmento), Contato: _s_(dados.Contato),
    Cidade: _s_(dados.Cidade), UF: _s_(dados.UF).toUpperCase().slice(0, 2),
    Telefone: _s_(dados.Telefone), Email: email, Website: _s_(dados.Website), Observacoes: _s_(dados.Observacoes).slice(0, 300)
  };
}

function apiCadastrarEmpresa(token, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'empresas', 'criar');
    return _comLock_(function() {
      const novos = _dadosEmpresa_(dados, null);
      const mesmoNome = dbListar_(DB.EMPRESAS, e => _s_(e.Nome).toLowerCase() === novos.Nome.toLowerCase())[0];
      if (mesmoNome && !novos.CNPJ) throw new Error('Já existe a empresa "' + mesmoNome.Nome + '". Use a existente ou informe o CNPJ para diferenciar.');
      novos.Criado_Em = new Date();
      const e = dbInserir_(DB.EMPRESAS, novos);
      return { ok: true, mensagem: 'Empresa cadastrada.', dados: { id: e.ID_Empresa } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiEditarEmpresa(token, idEmpresa, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'empresas', 'editar');
    return _comLock_(function() {
      if (!dbBuscarPorId_(DB.EMPRESAS, idEmpresa)) throw new Error('Empresa não encontrada.');
      const novos = _dadosEmpresa_(dados, idEmpresa);
      dbAtualizar_(DB.EMPRESAS, idEmpresa, novos);
      logAudit_('UPDATE', 'Empresas', idEmpresa, 'Empresa editada por ' + rotuloSessao_(s));
      return { ok: true, mensagem: 'Empresa ' + novos.Nome + ' atualizada.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Exclui empresa criada por engano. Bloqueia se tiver lote ou se alguém
// dela já participou de evento; pessoas vinculadas (que nunca
// participaram) continuam no cadastro, só ficam sem empresa.
function apiExcluirEmpresa(token, idEmpresa) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'empresas', 'excluir');
    return _comLock_(function() {
      const e = dbBuscarPorId_(DB.EMPRESAS, idEmpresa);
      if (!e) throw new Error('Empresa não encontrada.');
      const lotes = dbListar_(DB.LOTES, l => l.ID_Empresa === idEmpresa);
      if (lotes.length) throw new Error(_s_(e.Nome) + ' tem ' + lotes.length + ' lote(s) de convite. A empresa fica no histórico e não pode ser excluída.');
      const pessoas = dbListar_(DB.PESSOAS, p => p.ID_Empresa === idEmpresa);
      const part = _participacaoPessoas_();
      const participaram = pessoas.filter(p => (part[p.ID_Pessoa] || {}).presencas);
      if (participaram.length) throw new Error('Pessoas de ' + _s_(e.Nome) + ' já participaram de eventos (ex.: ' + _s_(participaram[0].Nome) + '). A empresa fica no histórico e não pode ser excluída.');
      const soltar = {};
      pessoas.forEach(p => { soltar[p.ID_Pessoa] = { ID_Empresa: '' }; });
      dbAtualizarVarios_(DB.PESSOAS, soltar);
      dbExcluir_(DB.EMPRESAS, idEmpresa);
      logAudit_('DELETE', 'Empresas', idEmpresa, 'Empresa "' + _s_(e.Nome) + '" excluída por ' + rotuloSessao_(s));
      return { ok: true, mensagem: 'Empresa excluída.' + (pessoas.length ? ' ' + pessoas.length + ' pessoa(s) ficaram sem empresa.' : '') };
    });
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
    // Gestor responsável: o próprio gestor, o gestor vinculado ao
    // organizador ou o escolhido na lista (ver _gestorResponsavel_).
    const gestorFinal = _gestorResponsavel_(s, gestor);

    return _comLock_(function() {
      const vg = _vagasEvento_(idEvento);
      if (vg.disponiveis !== null && vg.disponiveis < 1) {
        throw new Error('Capacidade do evento atingida (' + vg.ativos + ' de ' + vg.capacidade + '). Aumente a capacidade do evento para continuar.');
      }

      let idPessoa = _s_(pessoa.idPessoa);
      let reaproveitada = null;
      if (idPessoa && !dbBuscarPorId_(DB.PESSOAS, idPessoa)) throw new Error('Pessoa não encontrada no diretório.');

      if (!idPessoa) {
        if (!pessoa.dados || !_s_(pessoa.dados.Nome)) throw new Error('Informe o nome.');
        const igual = _pessoaPorDocumento_(pessoa.dados.Documento);
        if (igual) { idPessoa = igual.ID_Pessoa; reaproveitada = igual.Nome; }
        if (!idPessoa) {
          const nova = dbInserir_(DB.PESSOAS, {
            Nome: _s_(pessoa.dados.Nome), Documento: _s_(pessoa.dados.Documento),
            Categoria: _categoriaValida_(_s_(pessoa.dados.Categoria)), ID_Empresa: _s_(pessoa.dados.ID_Empresa),
            Cargo: _s_(pessoa.dados.Cargo), Telefone: _s_(pessoa.dados.Telefone), Email: _s_(pessoa.dados.Email).toLowerCase(),
            Data_Cadastro: new Date(), Ativo: 'Sim', Gestor_Responsavel: gestorFinal
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

// Antes do dia do evento (Admin pode corrigir depois).
function _antesDoEvento_(idEvento, sessao, acao) {
  const ev = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!ev) throw new Error('Evento não encontrado.');
  if (!ev.Data || sessao.perfil === 'Admin') return ev;
  const hoje = Number(_fmtData_(new Date(), 'yyyyMMdd'));
  if (hoje >= Number(_fmtData_(ev.Data, 'yyyyMMdd'))) {
    throw new Error('Não é possível ' + acao + ' a partir do dia do evento (' + _fmtData_(ev.Data) + '). Use "Cancelar" ou fale com o administrador.');
  }
  return ev;
}

// Exclui o convite da lista (lista mais limpa). Só antes do dia do evento
// e nunca apaga histórico: check-in feito ou troca registrada ficam.
function apiExcluirConvite(token, idConvite) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'convites', 'excluir');
    return _comLock_(function() {
      const c = dbBuscarPorId_(DB.CONVITES, idConvite);
      if (!c) throw new Error('Convite não encontrado.');
      _antesDoEvento_(c.ID_Evento, s, 'excluir convidados da lista');
      if (c.Status === 'Presente') throw new Error('Este convidado já fez check-in; o registro não pode ser excluído.');
      if (c.Status === 'Substituído') throw new Error('Este convite faz parte de uma troca registrada. Exclua o substituto, se for o caso.');
      if (c.Origem === 'Substituição' && c.ID_Convite_Original) {
        // Excluir o substituto devolve o lugar ao convidado original.
        const orig = dbBuscarPorId_(DB.CONVITES, c.ID_Convite_Original);
        if (orig && orig.Status === 'Substituído') {
          dbAtualizar_(DB.CONVITES, orig.ID_Convite, { Status: 'Convidado', QR_Valido: 'Sim', Motivo_Substituicao: '', Autorizado_Por: '' });
        }
      }
      const p = dbBuscarPorId_(DB.PESSOAS, c.ID_Pessoa) || {};
      dbExcluir_(DB.CONVITES, idConvite);
      logAudit_('DELETE', 'Convites', idConvite, '"' + _s_(p.Nome) + '" excluído da lista por ' + rotuloSessao_(s));
      return { ok: true, mensagem: _s_(p.Nome) + ' foi excluído(a) da lista.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Troca antes do evento: a pessoa avisou que outra irá no lugar dela.
// O original fica como "Substituído" (histórico) e o novo convite nasce
// com link próprio, a mesma mesa e o mesmo gestor.
// novo: { idPessoa } (do diretório) ou { dados: { Nome, Documento, ... } }
function apiTrocarConvidado(token, idConvite, novo, motivo) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'convites', 'criar');
    novo = novo || {};
    return _comLock_(function() {
      const c = dbBuscarPorId_(DB.CONVITES, idConvite);
      if (!c) throw new Error('Convite não encontrado.');
      _antesDoEvento_(c.ID_Evento, s, 'trocar convidados (na porta, use a substituição do check-in)');
      if (['Convidado', 'Confirmado', 'Recusado'].indexOf(c.Status) === -1) throw new Error('Só é possível trocar convites ativos (convidado, confirmado ou recusado).');

      let idPessoa = _s_(novo.idPessoa);
      if (idPessoa) {
        if (!dbBuscarPorId_(DB.PESSOAS, idPessoa)) throw new Error('Pessoa não encontrada no diretório.');
      } else {
        const d = novo.dados || {};
        if (!_s_(d.Nome)) throw new Error('Informe o nome de quem vai no lugar.');
        const existente = _pessoaPorDocumento_(d.Documento);
        if (existente) idPessoa = existente.ID_Pessoa;
        else {
          idPessoa = dbInserir_(DB.PESSOAS, {
            Nome: _s_(d.Nome), Documento: _s_(d.Documento), Cargo: _s_(d.Cargo),
            Telefone: _s_(d.Telefone), Email: _s_(d.Email).toLowerCase(),
            Categoria: _categoriaValida_(_s_(d.Categoria)), ID_Empresa: _s_(d.ID_Empresa),
            Data_Cadastro: new Date(), Ativo: 'Sim', Gestor_Responsavel: _s_(c.Gestor)
          }).ID_Pessoa;
        }
      }
      const statusNovo = c.Status === 'Confirmado' ? 'Confirmado' : 'Convidado';
      const antes = dbBuscarPorId_(DB.PESSOAS, c.ID_Pessoa) || {};
      const nc = substituirConvidado_(idConvite, idPessoa, _s_(motivo) || 'Troca avisada antes do evento', rotuloSessao_(s), statusNovo);
      dbAtualizar_(DB.CONVITES, nc.ID_Convite, { Cadastrado_Por: rotuloSessao_(s), Observacoes: _s_(c.Observacoes) });
      const depois = dbBuscarPorId_(DB.PESSOAS, idPessoa) || {};
      logAudit_('UPDATE', 'Convites', idConvite, 'Troca: "' + _s_(antes.Nome) + '" → "' + _s_(depois.Nome) + '" por ' + rotuloSessao_(s));
      return { ok: true, mensagem: _s_(antes.Nome) + ' foi trocado(a) por ' + _s_(depois.Nome) + '.', dados: {
        nome: _s_(depois.Nome), linkConfirmacao: _linkConfirmacao_(nc.QR_Token)
      } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Busca no diretório (para adicionar/trocar escolhendo alguém já cadastrado).
function apiBuscarPessoas(token, termo, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const q = _s_(termo).toLowerCase(), qd = _soDigitos_(termo);
  if (q.length < 2) return { ok: true, dados: [] };
  const naLista = {};
  if (idEvento) dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento && _conviteAtivo_(c)).forEach(c => naLista[c.ID_Pessoa] = true);
  const empresas = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = _s_(e.Nome));
  const achados = dbListar_(DB.PESSOAS, p =>
    _s_(p.Nome).toLowerCase().indexOf(q) !== -1 || (qd.length >= 4 && _soDigitos_(p.Documento).indexOf(qd) !== -1)
  ).slice(0, 12);
  return { ok: true, dados: achados.map(p => ({
    id: p.ID_Pessoa, nome: _s_(p.Nome), empresa: _s_(empresas[p.ID_Empresa]), cargo: _s_(p.Cargo),
    // documento parcialmente oculto: só para diferenciar homônimos
    doc: _soDigitos_(p.Documento) ? '•••' + _soDigitos_(p.Documento).slice(-4) : '',
    naLista: !!naLista[p.ID_Pessoa]
  })) };
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
