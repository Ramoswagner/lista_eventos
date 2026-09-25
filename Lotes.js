/**
 * ============================================================
 * LOTES.GS - Lotes de convite com link público
 * ============================================================
 * Fluxo:
 *   1. Gestor cria um lote (N vagas, evento, empresa opcional)
 *   2. Sistema gera um token único → link público
 *   3. Empresa/grupo acessa o link → preenche dados → consome vaga
 *      e recebe o próprio link pessoal (com QR Code para a entrada)
 *   4. Dias antes: acessa o link novamente e, informando CPF ou e-mail,
 *      confirma ou cancela a inscrição
 *
 * Status do lote: "Aberto" ou "Encerrado" (manual, pelo gestor) ou
 * "Expirado" (data de expiração passou). Lote lotado continua "Aberto":
 * se alguém cancelar, a vaga volta a ficar disponível sozinha.
 * ============================================================
 */

function _vagasUsadasLote_(idLote) {
  return dbContar_(DB.CONVITES, c => c.ID_Lote === idLote && _conviteAtivo_(c));
}

function _lotePorToken_(loteToken) {
  const t = _s_(loteToken);
  if (!t) return null;
  return dbListar_(DB.LOTES, l => _s_(l.Token) === t)[0] || null;
}

// Marca como Expirado se a data passou. Retorna o status atualizado.
function _statusLote_(lote) {
  if (lote.Status === 'Aberto' && lote.Data_Expiracao) {
    const expira = new Date(lote.Data_Expiracao);
    if (!isNaN(expira.getTime()) && new Date() > expira) {
      dbAtualizar_(DB.LOTES, lote.ID_Lote, { Status: 'Expirado' });
      lote.Status = 'Expirado';
    }
  }
  return lote.Status || 'Aberto';
}

// ------------------------------------------------------------
// CRIAR / LISTAR / ENCERRAR (área logada)
// ------------------------------------------------------------
function apiCriarLote(token, dados) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    _exigirPermissao_(s, 'lotes', 'criar');
    if (!dados || !dados.ID_Evento) throw new Error('Informe o evento.');
    const vagasTotal = Math.floor(Number(dados.Vagas_Total));
    if (!vagasTotal || vagasTotal < 1) throw new Error('Informe o número de vagas (mínimo 1).');

    return _comLock_(function() {
      const evento = dbBuscarPorId_(DB.EVENTOS, dados.ID_Evento);
      if (!evento) throw new Error('Evento não encontrado.');

      const vg = _vagasEvento_(dados.ID_Evento);
      if (vg.disponiveis !== null && vagasTotal > vg.disponiveis) {
        throw new Error('Esse lote pede ' + vagasTotal + ' vaga(s), mas o evento só tem ' + vg.disponiveis +
          ' disponível(is) (' + vg.ativos + ' de ' + vg.capacidade + ' já ocupadas).');
      }

      const loteToken = Utilities.getUuid();
      const lote = dbInserir_(DB.LOTES, {
        ID_Evento:       dados.ID_Evento,
        ID_Empresa:      _s_(dados.ID_Empresa),
        Gestor:          _gestorResponsavel_(s, dados.Gestor),
        Token:           loteToken,
        Vagas_Total:     vagasTotal,
        Status:          'Aberto',
        Data_Expiracao:  dados.Data_Expiracao ? _parseDataLocal_(dados.Data_Expiracao, true) : '',
        Observacoes:     _s_(dados.Observacoes),
        Criado_Em:       new Date()
      });

      logAudit_('INSERT', 'Lotes', lote.ID_Lote, 'Lote criado por ' + rotuloSessao_(s));

      return {
        ok: true,
        mensagem: 'Lote criado com sucesso.',
        dados: {
          id: lote.ID_Lote,
          link: _urlBase_() + '?pagina=convite&token=' + loteToken,
          vagas: vagasTotal
        }
      };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Lista os lotes (com info de vagas usadas).
 */
function apiListarLotes(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;

  const empresas = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);

  // Conta vagas usadas de todos os lotes numa passada só.
  const usadas = {};
  dbListar_(DB.CONVITES, c => c.ID_Lote && _conviteAtivo_(c)).forEach(c => {
    usadas[c.ID_Lote] = (usadas[c.ID_Lote] || 0) + 1;
  });

  const lotes = idEvento
    ? dbListar_(DB.LOTES, l => l.ID_Evento === idEvento)
    : dbListar_(DB.LOTES);
  const urlBase = _urlBase_();

  return { ok: true, dados: lotes.map(l => {
    const total = Number(l.Vagas_Total) || 0;
    const vagasUsadas = usadas[l.ID_Lote] || 0;
    return {
      id:           l.ID_Lote,
      evento:       l.ID_Evento,
      empresa:      _s_(empresas[l.ID_Empresa]),
      gestor:       _s_(l.Gestor),
      link:         urlBase + '?pagina=convite&token=' + l.Token,
      vagasTotal:   total,
      vagasUsadas:  vagasUsadas,
      vagasLivres:  Math.max(0, total - vagasUsadas),
      status:       _statusLote_(l),
      expiracao:    _fmtData_(l.Data_Expiracao),
      obs:          _s_(l.Observacoes)
    };
  }) };
}

/**
 * Encerra um lote manualmente (não aceita mais inscrições).
 */
function apiEncerrarLote(token, idLote) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    _exigirPermissao_(s, 'lotes', 'editar');
    const lote = dbBuscarPorId_(DB.LOTES, idLote);
    if (!lote) throw new Error('Lote não encontrado.');
    dbAtualizar_(DB.LOTES, idLote, { Status: 'Encerrado' });
    return { ok: true, mensagem: 'Lote encerrado.' };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Reabre um lote encerrado ou expirado (se tinha data de expiração
 * vencida, ela é removida).
 */
function apiReabrirLote(token, idLote) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    _exigirPermissao_(s, 'lotes', 'editar');
    const lote = dbBuscarPorId_(DB.LOTES, idLote);
    if (!lote) throw new Error('Lote não encontrado.');
    const novos = { Status: 'Aberto' };
    if (lote.Data_Expiracao && new Date() > new Date(lote.Data_Expiracao)) novos.Data_Expiracao = '';
    dbAtualizar_(DB.LOTES, idLote, novos);
    return { ok: true, mensagem: 'Lote reaberto.' };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// ------------------------------------------------------------
// TELA PÚBLICA (sem login) — ConvitePublico.html
// ------------------------------------------------------------

/**
 * Informações públicas do lote. Lote encerrado/expirado ainda abre a
 * página (para quem já se inscreveu confirmar ou cancelar), mas com o
 * formulário de inscrição fechado.
 * Não expõe e-mail, documento nem ID dos inscritos.
 */
function apiInfoLotePublico(loteToken) {
  try {
    const lote = _lotePorToken_(loteToken);
    if (!lote) return { ok: false, mensagem: 'Link inválido.' };

    const evento = dbBuscarPorId_(DB.EVENTOS, lote.ID_Evento);
    if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };

    const status = _statusLote_(lote);
    const empresa = lote.ID_Empresa ? dbBuscarPorId_(DB.EMPRESAS, lote.ID_Empresa) : null;
    const vagasUsadas = _vagasUsadasLote_(lote.ID_Lote);
    const vagasLivres = Math.max(0, Number(lote.Vagas_Total) - vagasUsadas);

    const pessoas = {};
    dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
    const inscritos = dbListar_(DB.CONVITES, c => c.ID_Lote === lote.ID_Lote && _conviteAtivo_(c))
      .map(c => {
        const p = pessoas[c.ID_Pessoa] || {};
        return { nome: _s_(p.Nome), cargo: _s_(p.Cargo), status: _s_(c.Status) };
      });

    let motivoFechado = '';
    if (status === 'Encerrado') motivoFechado = 'As inscrições deste lote foram encerradas.';
    else if (status === 'Expirado') motivoFechado = 'As inscrições deste lote expiraram.';
    else if (vagasLivres <= 0) motivoFechado = 'Todas as vagas deste lote já foram preenchidas.';

    return { ok: true, dados: {
      evento:      _s_(evento.Nome),
      dataEvento:  _fmtData_(evento.Data),
      local:       _s_(evento.Local),
      empresa:     empresa ? _s_(empresa.Nome) : '',
      vagasTotal:  Number(lote.Vagas_Total) || 0,
      vagasUsadas,
      vagasLivres,
      inscricaoAberta: !motivoFechado,
      motivoFechado,
      inscritos
    } };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Inscrição pública: a pessoa preenche os dados e consome uma vaga.
 * Devolve o link pessoal (confirmação + QR Code da entrada).
 */
function apiInscreverNoLote(loteToken, dadosPessoa) {
  try {
    if (!dadosPessoa || !_s_(dadosPessoa.Nome)) return { ok: false, mensagem: 'Nome é obrigatório.' };
    if (!_s_(dadosPessoa.Documento) && !_s_(dadosPessoa.Email)) {
      return { ok: false, mensagem: 'Informe o CPF ou o e-mail (usado para confirmar ou cancelar depois).' };
    }

    return _comLock_(function() {
      const lote = _lotePorToken_(loteToken);
      if (!lote) return { ok: false, mensagem: 'Link inválido.' };
      if (_statusLote_(lote) !== 'Aberto') return { ok: false, mensagem: 'As inscrições deste lote não estão abertas.' };

      if (_vagasUsadasLote_(lote.ID_Lote) >= Number(lote.Vagas_Total)) {
        return { ok: false, mensagem: 'Todas as vagas deste lote já foram preenchidas.' };
      }
      const vg = _vagasEvento_(lote.ID_Evento);
      if (vg.disponiveis !== null && vg.disponiveis < 1) {
        return { ok: false, mensagem: 'O evento atingiu a capacidade máxima.' };
      }

      // Deduplicação por documento
      const existente = _pessoaPorDocumento_(dadosPessoa.Documento);
      let idPessoa = existente ? existente.ID_Pessoa : null;

      if (idPessoa) {
        const jaInscrito = dbListar_(DB.CONVITES, c =>
          c.ID_Evento === lote.ID_Evento && c.ID_Pessoa === idPessoa && _conviteAtivo_(c)
        );
        if (jaInscrito.length) return { ok: false, mensagem: 'Este documento já possui inscrição neste evento.' };
      } else {
        const nova = dbInserir_(DB.PESSOAS, {
          Nome:          _s_(dadosPessoa.Nome),
          Documento:     _s_(dadosPessoa.Documento),
          Telefone:      _s_(dadosPessoa.Telefone),
          Email:         _s_(dadosPessoa.Email).toLowerCase(),
          Cargo:         _s_(dadosPessoa.Cargo),
          ID_Empresa:    _s_(lote.ID_Empresa),
          Categoria:     'Outro',
          Observacoes:   'Cadastro via lote público',
          Gestor_Responsavel: _s_(lote.Gestor),
          Data_Cadastro: new Date(),
          Ativo:         'Sim'
        });
        idPessoa = nova.ID_Pessoa;
      }

      const convite = convidarPessoa_(lote.ID_Evento, idPessoa, lote.Gestor, lote.ID_Lote);

      return {
        ok: true,
        mensagem: 'Inscrição realizada com sucesso! Você está na lista.',
        dados: { linkPessoal: _linkConfirmacao_(convite.QR_Token) }
      };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// Acha a inscrição ativa deste lote pelo CPF ou e-mail informado.
function _inscricaoPorBusca_(lote, busca) {
  const b = _s_(busca).toLowerCase();
  if (!b) return null;
  const doc = _soDigitos_(b);
  const pessoas = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  return dbListar_(DB.CONVITES, c => c.ID_Lote === lote.ID_Lote && _conviteAtivo_(c)).filter(c => {
    const p = pessoas[c.ID_Pessoa] || {};
    const email = _s_(p.Email).toLowerCase();
    return (email && email === b) || (doc.length >= 5 && _soDigitos_(p.Documento) === doc);
  }).map(c => ({ convite: c, pessoa: pessoas[c.ID_Pessoa] || {} }))[0] || null;
}

/**
 * Busca a própria inscrição (CPF ou e-mail) para confirmar/cancelar.
 */
function apiBuscarInscricaoLote(loteToken, busca) {
  try {
    const lote = _lotePorToken_(loteToken);
    if (!lote) return { ok: false, mensagem: 'Link inválido.' };
    const achou = _inscricaoPorBusca_(lote, busca);
    if (!achou) return { ok: false, mensagem: 'Nenhuma inscrição encontrada com este dado.' };
    return { ok: true, dados: {
      nome:   _s_(achou.pessoa.Nome),
      cargo:  _s_(achou.pessoa.Cargo),
      status: _s_(achou.convite.Status)
    } };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Confirmação/cancelamento da inscrição pelo link público.
 * Identifica o inscrito de novo pelo CPF/e-mail (não aceita ID de convite
 * vindo do navegador).
 */
function apiResponderPorLote(loteToken, busca, resposta) {
  try {
    if (['Confirmado', 'Cancelado'].indexOf(resposta) === -1) return { ok: false, mensagem: 'Resposta inválida.' };
    return _comLock_(function() {
      const lote = _lotePorToken_(loteToken);
      if (!lote) return { ok: false, mensagem: 'Link inválido.' };
      const achou = _inscricaoPorBusca_(lote, busca);
      if (!achou) return { ok: false, mensagem: 'Nenhuma inscrição encontrada com este dado.' };
      const convite = achou.convite;
      if (convite.Status === 'Presente') return { ok: false, mensagem: 'Você já fez check-in. Não é possível alterar.' };

      if (resposta === 'Cancelado') {
        dbAtualizar_(DB.CONVITES, convite.ID_Convite, {
          Status: 'Cancelado',
          QR_Valido: 'Não',
          Observacoes: (convite.Observacoes ? _s_(convite.Observacoes) + ' | ' : '') +
                       'Cancelado pelo próprio inscrito em ' + _fmtData_(new Date(), 'dd/MM/yyyy HH:mm')
        });
        return { ok: true, mensagem: 'Sua inscrição foi cancelada.' };
      }

      responderConvite_(convite.ID_Convite, 'Confirmado');
      return { ok: true, mensagem: 'Presença confirmada! Até breve.' };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}
