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
  'config':         'ConfigPainel'     // gestão de logins
};

// ------------------------------------------------------------
// ENTRY POINT
// ------------------------------------------------------------
function doGet(e) {
  const pagina = (e && e.parameter && e.parameter.pagina) || 'app';
  const token  = (e && e.parameter && e.parameter.token)  || '';

  // Tela pública de lote (sem login) — empresa se inscreve num lote com vagas
  if (pagina === 'convite' && token) {
    const tpl = HtmlService.createTemplateFromFile('ConvitePublico');
    tpl.loteToken = token;
    tpl.urlBase   = ScriptApp.getService().getUrl();
    return tpl.evaluate()
      .setTitle('Inscrição — Eventos Hospital da Baleia')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Tela pública de confirmação individual (sem login) — qualquer convidado
  // (manual, lote ou substituição) confirma/recusa presença pelo próprio link
  if (pagina === 'confirmar' && token) {
    const tpl = HtmlService.createTemplateFromFile('ConfirmarPresenca');
    tpl.qrToken = token;
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
    return '<div class="alert alert-danger">Página não encontrada: ' + viewName + '</div>';
  }
  try {
    return HtmlService.createHtmlOutputFromFile(fileName).getContent();
  } catch (e) {
    return '<div class="alert alert-danger">Erro ao carregar view: ' + e.message + '</div>';
  }
}

// ------------------------------------------------------------
// BOOTSTRAP (tudo em uma chamada só)
// ------------------------------------------------------------
function apiBootstrapGestao(token) {
  const s = validarSessao(token);
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
  const s = validarSessao(token);
  if (!s) return NEGADO;
  return { ok: true, dados: {
    convidados: apiListaConvidados(token, idEvento).dados     || [],
    lotes:      apiListarLotes(token, idEvento).dados          || [],
    empresas:   apiListarEmpresas(token).dados                 || [],
    gestores:   apiListarGestoresNomes(token).dados             || [],
    vagas:      _vagasEvento(idEvento)
  } };
}

// ------------------------------------------------------------
// EVENTOS
// ------------------------------------------------------------
function apiListarEventos(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar(DB.EVENTOS, e => e.Status !== 'Encerrado').map(e => ({
    id:     e.ID_Evento,
    nome:   e.Nome,
    data:   e.Data ? new Date(e.Data).toLocaleDateString('pt-BR') : '',
    local:  e.Local || '',
    status: e.Status || ''
  })) };
}

function apiListarEventosTodos(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar(DB.EVENTOS).map(e => ({
    id:         e.ID_Evento,
    nome:       e.Nome,
    data:       e.Data ? new Date(e.Data).toLocaleDateString('pt-BR') : '',
    local:      e.Local || '',
    status:     e.Status || '',
    capacidade: e.Capacidade || 0
  })) };
}

function apiCadastrarEvento(token, dados) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador cria eventos.' };
  try {
    if (!dados || !dados.Nome) throw new Error('Nome do evento é obrigatório.');
    if (dados.Data) dados.Data = new Date(dados.Data);
    dados.Status    = dados.Status || 'Planejamento';
    dados.Criado_Em = new Date();
    const ev = dbInserir(DB.EVENTOS, dados);
    logAudit('INSERT', 'Eventos', ev.ID_Evento, 'Evento criado por ' + rotuloSessao(s));
    return { ok: true, mensagem: 'Evento criado: ' + ev.ID_Evento, dados: { id: ev.ID_Evento } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiEditarEvento(token, idEvento, dados) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador edita eventos.' };
  try {
    const ev = dbBuscarPorId(DB.EVENTOS, idEvento);
    if (!ev) throw new Error('Evento não encontrado.');
    if (!dados.Nome) throw new Error('Nome é obrigatório.');
    const novos = { Nome: dados.Nome.trim(), Local: dados.Local || '', Status: dados.Status || ev.Status,
                    Capacidade: dados.Capacidade || '', Observacoes: dados.Observacoes || '' };
    if (dados.Data) novos.Data = new Date(dados.Data);
    dbAtualizar(DB.EVENTOS, idEvento, novos);
    return { ok: true, mensagem: 'Evento atualizado.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiExcluirEvento(token, idEvento) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador exclui eventos.' };
  try {
    const ev = dbBuscarPorId(DB.EVENTOS, idEvento);
    if (!ev) throw new Error('Evento não encontrado.');
    const convites = dbListar(DB.CONVITES, c => c.ID_Evento === idEvento);
    convites.forEach(c => dbExcluir(DB.CONVITES, c.ID_Convite));
    dbExcluir(DB.EVENTOS, idEvento);
    return { ok: true, mensagem: 'Evento "' + ev.Nome + '" excluído com ' + convites.length + ' convite(s).' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// PESSOAS
// ------------------------------------------------------------
function apiListarPessoas(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  const empresas = {};
  dbListar(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
  return { ok: true, dados: dbListar(DB.PESSOAS).map(p => ({
    id:         p.ID_Pessoa,
    nome:       p.Nome,
    documento:  p.Documento || '',
    telefone:   p.Telefone || '',
    email:      p.Email || '',
    cargo:      p.Cargo || '',
    categoria:  p.Categoria || '',
    empresa:    empresas[p.ID_Empresa] || '',
    idEmpresa:  p.ID_Empresa || '',
    cidade:     (p.Cidade || '') + (p.UF ? '/' + p.UF : ''),
    ativo:      p.Ativo || 'Sim'
  })) };
}

function apiCadastrarPessoa(token, dados) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    if (!dados || !dados.Nome) throw new Error('Nome é obrigatório.');
    const p = dbInserir(DB.PESSOAS, {
      Nome: dados.Nome.trim(), Documento: dados.Documento || '',
      Telefone: dados.Telefone || '', Email: dados.Email || '',
      ID_Empresa: dados.ID_Empresa || '', Cargo: dados.Cargo || '',
      Cidade: dados.Cidade || '', UF: dados.UF || '',
      Categoria: dados.Categoria || 'Outro',
      Data_Cadastro: new Date(), Ativo: 'Sim'
    });
    return { ok: true, mensagem: 'Pessoa cadastrada.', dados: { id: p.ID_Pessoa } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// EMPRESAS
// ------------------------------------------------------------
function apiListarEmpresas(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  return { ok: true, dados: dbListar(DB.EMPRESAS).map(e => ({
    id:       e.ID_Empresa,
    nome:     e.Nome,
    segmento: e.Segmento || '',
    cidade:   (e.Cidade || '') + (e.UF ? '/' + e.UF : ''),
    contato:  e.Contato || ''
  })) };
}

function apiCadastrarEmpresa(token, dados) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    if (!dados || !dados.Nome) throw new Error('Nome da empresa é obrigatório.');
    dados.Criado_Em = new Date();
    const e = dbInserir(DB.EMPRESAS, dados);
    return { ok: true, mensagem: 'Empresa cadastrada.', dados: { id: e.ID_Empresa } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CONVITES
// ------------------------------------------------------------
function apiListaConvidados(token, idEvento) {
  const s = validarSessao(token);
  if (!s) return NEGADO;

  const pessoas  = {};
  const empresas = {};
  dbListar(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  dbListar(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e);

  const convites = dbListar(DB.CONVITES, c => c.ID_Evento === idEvento);
  const substitutoDe = {};
  convites.forEach(c => { if (c.ID_Convite_Original) substitutoDe[c.ID_Convite_Original] = c; });

  const urlBase = ScriptApp.getService().getUrl();
  return { ok: true, dados: convites.map(c => {
    const p    = pessoas[c.ID_Pessoa]   || {};
    const emp  = empresas[p.ID_Empresa] || {};
    const sub  = substitutoDe[c.ID_Convite];
    const pSub = sub ? (pessoas[sub.ID_Pessoa] || {}) : null;
    return {
      idConvite:        c.ID_Convite,
      nome:             p.Nome || '(pessoa não encontrada)',
      documento:        p.Documento || '',
      categoria:        p.Categoria || '',
      empresa:          emp.Nome || '',
      cargo:            p.Cargo || '',
      cidade:           (p.Cidade || '') + (p.UF ? '/' + p.UF : ''),
      gestor:           c.Gestor || '',
      status:           c.Status,
      origem:           c.Origem,
      qrToken:          c.QR_Token || '',
      linkConfirmacao:  c.QR_Token ? urlBase + '?pagina=confirmar&token=' + c.QR_Token : '',
      checkinHora:      c.Checkin_DataHora
        ? new Date(c.Checkin_DataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      substituidoPor:   pSub ? pSub.Nome : '',
      idLote:           c.ID_Lote || '',
      descricao:        c.Observacoes || ''
    };
  }) };
}

function apiAdicionarNaLista(token, gestor, pessoa) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    const idEvento = pessoa.idEvento;
    if (!idEvento) throw new Error('Evento não informado.');
    // Gestor é sempre quem está logado — "gestor" só existe como parâmetro
    // por compatibilidade; o nome nunca vem descrito, sempre o nome puro.
    const gestorFinal = (gestor || s.gestor || '').trim();
    if (!gestorFinal) throw new Error('Informe o gestor responsável.');

    const vg = _vagasEvento(idEvento);
    if (vg.disponiveis !== null && vg.disponiveis < 1) {
      throw new Error('Capacidade do evento atingida (' + vg.ativos + ' de ' + vg.capacidade + '). Aumente a capacidade do evento para continuar.');
    }

    let idPessoa = pessoa.idPessoa;
    let reaproveitada = null;

    if (!idPessoa) {
      if (!pessoa.dados || !pessoa.dados.Nome) throw new Error('Informe o nome.');
      const doc = (pessoa.dados.Documento || '').replace(/\D/g, '');
      if (doc) {
        const igual = dbListar(DB.PESSOAS, p => (p.Documento || '').replace(/\D/g, '') === doc);
        if (igual.length) { idPessoa = igual[0].ID_Pessoa; reaproveitada = igual[0].Nome; }
      }
      if (!idPessoa) {
        const nova = dbInserir(DB.PESSOAS, {
          Nome: pessoa.dados.Nome.trim(), Documento: (pessoa.dados.Documento || '').trim(),
          Categoria: pessoa.dados.Categoria || 'Outro', ID_Empresa: pessoa.dados.ID_Empresa || '',
          Cargo: pessoa.dados.Cargo || '', Data_Cadastro: new Date(), Ativo: 'Sim'
        });
        idPessoa = nova.ID_Pessoa;
      }
    }

    // Descrição/observação vai na coluna própria (Observacoes) do convite —
    // nunca é misturada com o nome do gestor.
    const c = convidarPessoa(idEvento, idPessoa, gestorFinal, null, pessoa.descricao || '');
    dbAtualizar(DB.CONVITES, c.ID_Convite, { Cadastrado_Por: rotuloSessao(s) });

    const msg = reaproveitada
      ? 'Documento já cadastrado como "' + reaproveitada + '": pessoa reaproveitada.'
      : 'Adicionado à lista.';
    const urlBase = ScriptApp.getService().getUrl();
    return { ok: true, mensagem: msg, dados: {
      idConvite:       c.ID_Convite,
      qrToken:         c.QR_Token,
      linkConfirmacao: urlBase + '?pagina=confirmar&token=' + c.QR_Token
    }};
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiCancelarConvite(token, idConvite) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    const c = dbBuscarPorId(DB.CONVITES, idConvite);
    if (!c) throw new Error('Convite não encontrado.');
    if (c.Status === 'Presente')  throw new Error('Convidado já fez check-in; não é possível cancelar.');
    if (c.Status === 'Cancelado') throw new Error('Este convite já está cancelado.');
    const marca = 'Cancelado por ' + rotuloSessao(s) + ' em ' + new Date().toLocaleString('pt-BR');
    dbAtualizar(DB.CONVITES, idConvite, {
      Status: 'Cancelado',
      Observacoes: (c.Observacoes ? c.Observacoes + ' | ' : '') + marca
    });
    return { ok: true, mensagem: 'Convite cancelado.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CHECK-IN
// ------------------------------------------------------------
function apiCheckin(token, idConvite) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    const convite = dbBuscarPorId(DB.CONVITES, idConvite);
    if (!convite) throw new Error('Convite não encontrado.');
    _validarJanela(convite.ID_Evento, s);
    fazerCheckin(idConvite, rotuloSessao(s));
    return { ok: true, mensagem: 'Entrada confirmada.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiCheckinQR(token, qrToken) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    const convite = fazerCheckinPorQR(qrToken, rotuloSessao(s));
    const pessoa  = dbBuscarPorId(DB.PESSOAS, convite.ID_Pessoa);
    return { ok: true, mensagem: 'Bem-vindo, ' + (pessoa ? pessoa.Nome : '') + '!', dados: { nome: pessoa ? pessoa.Nome : '' } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiWalkin(token, idEvento, nome, categoria, autorizadoPor) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    _validarJanela(idEvento, s);
    registrarWalkin(idEvento, {
      dadosNovaPessoa: { Nome: nome, Categoria: categoria || 'Outro' },
      autorizadoPor:   autorizadoPor,
      checkinPor:      rotuloSessao(s)
    });
    return { ok: true, mensagem: 'Walk-in registrado. ' + nome + ' está presente.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiSubstituirEEntrar(token, idConviteOriginal, nomeSubstituto, categoria, motivo, autorizadoPor) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  try {
    const original = dbBuscarPorId(DB.CONVITES, idConviteOriginal);
    if (!original) throw new Error('Convite original não encontrado.');
    _validarJanela(original.ID_Evento, s);
    const nova = dbInserir(DB.PESSOAS, {
      Nome: nomeSubstituto, Categoria: categoria || 'Outro',
      Data_Cadastro: new Date(), Ativo: 'Sim'
    });
    const novoConvite = substituirConvidado(idConviteOriginal, nova.ID_Pessoa, motivo, autorizadoPor);
    fazerCheckin(novoConvite.ID_Convite, rotuloSessao(s));
    return { ok: true, mensagem: 'Substituição registrada. ' + nomeSubstituto + ' está presente.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
function apiDashboardEvento(token, idEvento) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  const evento = dbBuscarPorId(DB.EVENTOS, idEvento);
  if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };

  const resumo   = resumoEvento(idEvento);
  const pessoas  = {};
  dbListar(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  const convites = dbListar(DB.CONVITES, c => c.ID_Evento === idEvento);

  const porCategoria = {};
  const porGestor    = {};
  const checkinsPorHora = {};

  convites.forEach(c => {
    if (c.Status === 'Cancelado' || c.Status === 'Substituído') return;
    const p   = pessoas[c.ID_Pessoa] || {};
    const cat = p.Categoria || 'Outro';
    porCategoria[cat] = (porCategoria[cat] || 0) + 1;
    if (c.Gestor) porGestor[c.Gestor] = (porGestor[c.Gestor] || 0) + 1;
    if (c.Status === 'Presente' && c.Checkin_DataHora) {
      const hora = new Date(c.Checkin_DataHora).getHours() + ':00';
      checkinsPorHora[hora] = (checkinsPorHora[hora] || 0) + 1;
    }
  });

  const topGestores = Object.keys(porGestor)
    .map(g => ({ gestor: g, total: porGestor[g] }))
    .sort((a, b) => b.total - a.total).slice(0, 6);

  return { ok: true, dados: {
    evento: { id: evento.ID_Evento, nome: evento.Nome,
              data: evento.Data ? new Date(evento.Data).toLocaleDateString('pt-BR') : '',
              capacidade: evento.Capacidade || 0 },
    resumo, porCategoria, topGestores, checkinsPorHora
  } };
}

function apiInfoCheckin(token, idEvento) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  const evento = dbBuscarPorId(DB.EVENTOS, idEvento);
  if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };
  const j = janelaEvento(evento);
  return { ok: true, dados: { janela: j.janela, mensagem: j.mensagem, dataFmt: j.dataFmt, admin: s.perfil === 'Admin' } };
}

function apiDadosCheckin(token, idEvento) {
  const s = validarSessao(token);
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
function _vagasEvento(idEvento) {
  const evento = dbBuscarPorId(DB.EVENTOS, idEvento);
  const capacidade = evento ? Number(evento.Capacidade) || 0 : 0;
  const ativos = dbContar(DB.CONVITES, c =>
    c.ID_Evento === idEvento &&
    ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
  );
  return {
    capacidade:   capacidade,
    ativos:       ativos,
    disponiveis:  capacidade > 0 ? Math.max(0, capacidade - ativos) : null
  };
}

function logAudit(acao, tabela, idRegistro, descricao) {
  try {
    dbInserir(DB.AUDIT_LOG, {
      Timestamp:  new Date(),
      Acao:       acao,
      Tabela:     tabela,
      ID_Registro: idRegistro,
      Valor_Novo:  descricao || ''
    });
  } catch (e) { Logger.log('Audit error: ' + e.message); }
}
