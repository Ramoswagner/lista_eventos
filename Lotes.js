/**
 * ============================================================
 * LOTES.GS - Lotes de convite com link público
 * ============================================================
 * Fluxo:
 *   1. Gestor cria um lote (N vagas, evento, empresa opcional)
 *   2. Sistema gera um token único → link público
 *   3. Empresa/grupo acessa o link → preenche dados → consome vaga
 *   4. Dias antes: acessa o link novamente para confirmar/cancelar
 * ============================================================
 */

// ------------------------------------------------------------
// CRIAR LOTE
// ------------------------------------------------------------

/**
 * Cria um lote de convites com link público.
 * Apenas Admin e Organizacao podem criar lotes.
 */
function apiCriarLote(token, dados) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (!temPermissao(s.perfil, 'lotes', 'criar')) {
      return { ok: false, mensagem: 'Sem permissão para criar lotes.' };
    }
    if (!dados.ID_Evento) throw new Error('Informe o evento.');
    if (!dados.Vagas_Total || dados.Vagas_Total < 1) throw new Error('Informe o número de vagas (mínimo 1).');

    const evento = dbBuscarPorId(DB.EVENTOS, dados.ID_Evento);
    if (!evento) throw new Error('Evento não encontrado.');

    const vg = _vagasEvento(dados.ID_Evento);
    if (vg.disponiveis !== null && Number(dados.Vagas_Total) > vg.disponiveis) {
      throw new Error('Esse lote pede ' + dados.Vagas_Total + ' vaga(s), mas o evento só tem ' + vg.disponiveis +
        ' disponível(is) (' + vg.ativos + ' de ' + vg.capacidade + ' já ocupadas).');
    }

    const loteToken = Utilities.getUuid();
    const urlBase  = ScriptApp.getService().getUrl();
    const linkPublico = urlBase + '?pagina=convite&token=' + loteToken;

    const lote = dbInserir(DB.LOTES, {
      ID_Evento:       dados.ID_Evento,
      ID_Empresa:      dados.ID_Empresa || '',
      Gestor:          s.gestor,
      Token:           loteToken,
      Vagas_Total:     Number(dados.Vagas_Total),
      Status:          'Aberto',
      Data_Expiracao:  dados.Data_Expiracao ? new Date(dados.Data_Expiracao) : '',
      Observacoes:     dados.Observacoes || '',
      Criado_Em:       new Date()
    });

    logAudit('INSERT', 'Lotes', lote.ID_Lote, 'Lote criado por ' + rotuloSessao(s));

    return {
      ok: true,
      mensagem: 'Lote criado com sucesso.',
      dados: {
        id: lote.ID_Lote,
        token: loteToken,
        link: linkPublico,
        vagas: Number(dados.Vagas_Total)
      }
    };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Lista todos os lotes (com info de vagas usadas).
 */
function apiListarLotes(token, idEvento) {
  const s = validarSessao(token);
  if (!s) return NEGADO;

  const empresas = {};
  dbListar(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);

  let lotes = idEvento
    ? dbListar(DB.LOTES, l => l.ID_Evento === idEvento)
    : dbListar(DB.LOTES);

  return { ok: true, dados: lotes.map(l => {
    const vagasUsadas = dbContar(DB.CONVITES, c =>
      c.ID_Lote === l.ID_Lote &&
      ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
    );
    const urlBase = ScriptApp.getService().getUrl();
    return {
      id:           l.ID_Lote,
      evento:       l.ID_Evento,
      empresa:      empresas[l.ID_Empresa] || '',
      gestor:       l.Gestor || '',
      token:        l.Token,
      link:         urlBase + '?pagina=convite&token=' + l.Token,
      vagasTotal:   Number(l.Vagas_Total) || 0,
      vagasUsadas:  vagasUsadas,
      vagasLivres:  Math.max(0, (Number(l.Vagas_Total) || 0) - vagasUsadas),
      status:       l.Status || 'Aberto',
      expiracao:    l.Data_Expiracao ? new Date(l.Data_Expiracao).toLocaleDateString('pt-BR') : '',
      obs:          l.Observacoes || ''
    };
  }) };
}

/**
 * Encerra um lote manualmente (não aceita mais inscrições).
 */
function apiEncerrarLote(token, idLote) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (!temPermissao(s.perfil, 'lotes', 'editar')) return { ok: false, mensagem: 'Sem permissão.' };
    const lote = dbBuscarPorId(DB.LOTES, idLote);
    if (!lote) throw new Error('Lote não encontrado.');
    dbAtualizar(DB.LOTES, idLote, { Status: 'Encerrado' });
    return { ok: true, mensagem: 'Lote encerrado.' };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// ------------------------------------------------------------
// TELA PÚBLICA: validar token e retornar info do lote
// ------------------------------------------------------------

/**
 * Valida o token do lote e retorna as informações públicas.
 * Chamado pela tela pública (sem login).
 */
function apiInfoLotePublico(loteToken) {
  try {
    const lote = dbListar(DB.LOTES, l => l.Token === loteToken)[0];
    if (!lote) return { ok: false, mensagem: 'Link inválido ou expirado.' };
    if (lote.Status === 'Encerrado') return { ok: false, mensagem: 'Este lote de convites foi encerrado.' };
    if (lote.Status === 'Expirado')  return { ok: false, mensagem: 'Este lote de convites expirou.' };

    // Verifica expiração por data
    if (lote.Data_Expiracao) {
      const expira = new Date(lote.Data_Expiracao);
      if (!isNaN(expira.getTime()) && new Date() > expira) {
        dbAtualizar(DB.LOTES, lote.ID_Lote, { Status: 'Expirado' });
        return { ok: false, mensagem: 'Este lote de convites expirou em ' + expira.toLocaleDateString('pt-BR') + '.' };
      }
    }

    const evento = dbBuscarPorId(DB.EVENTOS, lote.ID_Evento);
    if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };

    const empresa = lote.ID_Empresa ? dbBuscarPorId(DB.EMPRESAS, lote.ID_Empresa) : null;

    const vagasUsadas = dbContar(DB.CONVITES, c =>
      c.ID_Lote === lote.ID_Lote &&
      ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
    );
    const vagasLivres = Math.max(0, Number(lote.Vagas_Total) - vagasUsadas);

    // Lista inscritos neste lote (para a empresa ver quem já se inscreveu)
    const pessoas = {};
    dbListar(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
    const inscritos = dbListar(DB.CONVITES, c =>
      c.ID_Lote === lote.ID_Lote &&
      ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
    ).map(c => {
      const p = pessoas[c.ID_Pessoa] || {};
      return {
        idConvite: c.ID_Convite,
        nome:      p.Nome || '',
        cargo:     p.Cargo || '',
        email:     p.Email || '',
        status:    c.Status
      };
    });

    return { ok: true, dados: {
      idLote:      lote.ID_Lote,
      evento:      evento.Nome,
      dataEvento:  evento.Data ? new Date(evento.Data).toLocaleDateString('pt-BR') : '',
      local:       evento.Local || '',
      empresa:     empresa ? empresa.Nome : '',
      gestor:      lote.Gestor || '',
      vagasTotal:  Number(lote.Vagas_Total),
      vagasUsadas,
      vagasLivres,
      inscritos
    } };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Inscrição pública: a pessoa preenche os dados e consome uma vaga.
 * Chamado pela tela pública (sem login).
 */
function apiInscreverNoLote(loteToken, dadosPessoa) {
  try {
    const lote = dbListar(DB.LOTES, l => l.Token === loteToken)[0];
    if (!lote) return { ok: false, mensagem: 'Link inválido.' };
    if (lote.Status !== 'Aberto') return { ok: false, mensagem: 'Este lote não está mais aberto.' };

    // Verifica expiração
    if (lote.Data_Expiracao) {
      const expira = new Date(lote.Data_Expiracao);
      if (!isNaN(expira.getTime()) && new Date() > expira) {
        dbAtualizar(DB.LOTES, lote.ID_Lote, { Status: 'Expirado' });
        return { ok: false, mensagem: 'As inscrições para este lote encerraram.' };
      }
    }

    // Verifica vagas disponíveis
    const vagasUsadas = dbContar(DB.CONVITES, c =>
      c.ID_Lote === lote.ID_Lote &&
      ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
    );
    if (vagasUsadas >= Number(lote.Vagas_Total)) {
      return { ok: false, mensagem: 'Todas as vagas deste lote já foram preenchidas.' };
    }

    if (!dadosPessoa || !dadosPessoa.Nome) return { ok: false, mensagem: 'Nome é obrigatório.' };

    // Deduplicação por documento
    let idPessoa = null;
    if (dadosPessoa.Documento) {
      const doc = (dadosPessoa.Documento || '').replace(/\D/g, '');
      if (doc) {
        const igual = dbListar(DB.PESSOAS, p => (p.Documento || '').replace(/\D/g, '') === doc);
        if (igual.length) idPessoa = igual[0].ID_Pessoa;
      }
    }

    // Verifica se já está inscrito neste lote
    if (idPessoa) {
      const jaInscrito = dbListar(DB.CONVITES, c =>
        c.ID_Lote === lote.ID_Lote &&
        c.ID_Pessoa === idPessoa &&
        ['Cancelado', 'Substituído'].indexOf(c.Status) === -1
      );
      if (jaInscrito.length) return { ok: false, mensagem: 'Este documento já possui inscrição neste lote.' };
    }

    // Cadastra pessoa se nova
    if (!idPessoa) {
      const nova = dbInserir(DB.PESSOAS, {
        Nome:          dadosPessoa.Nome.trim(),
        Documento:     dadosPessoa.Documento || '',
        Telefone:      dadosPessoa.Telefone || '',
        Email:         dadosPessoa.Email || '',
        Cargo:         dadosPessoa.Cargo || '',
        ID_Empresa:    lote.ID_Empresa || '',
        Categoria:     dadosPessoa.Categoria || 'Outro',
        Data_Cadastro: new Date(),
        Ativo:         'Sim'
      });
      idPessoa = nova.ID_Pessoa;
    }

    // Cria o convite
    const convite = convidarPessoa(lote.ID_Evento, idPessoa, lote.Gestor, lote.ID_Lote);

    // Encerra o lote automaticamente se esgotou
    const novasVagas = vagasUsadas + 1;
    if (novasVagas >= Number(lote.Vagas_Total)) {
      dbAtualizar(DB.LOTES, lote.ID_Lote, { Status: 'Encerrado' });
    }

    return {
      ok: true,
      mensagem: 'Inscrição realizada com sucesso! Você está na lista.',
      dados: { idConvite: convite.ID_Convite }
    };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Confirmação/cancelamento de inscrição pelo link público.
 * O inscrito retorna dias antes para confirmar ou cancelar.
 */
function apiResponderPorLote(loteToken, idConvite, resposta) {
  try {
    const lote = dbListar(DB.LOTES, l => l.Token === loteToken)[0];
    if (!lote) return { ok: false, mensagem: 'Link inválido.' };

    const convite = dbBuscarPorId(DB.CONVITES, idConvite);
    if (!convite) return { ok: false, mensagem: 'Convite não encontrado.' };
    if (convite.ID_Lote !== lote.ID_Lote) return { ok: false, mensagem: 'Este convite não pertence a este lote.' };
    if (convite.Status === 'Presente') return { ok: false, mensagem: 'Você já fez check-in. Não é possível cancelar.' };
    if (convite.Status === 'Cancelado') return { ok: false, mensagem: 'Este convite já está cancelado.' };

    if (resposta === 'Cancelado') {
      dbAtualizar(DB.CONVITES, idConvite, {
        Status: 'Cancelado',
        Observacoes: (convite.Observacoes ? convite.Observacoes + ' | ' : '') +
                     'Cancelado pelo próprio inscrito em ' + new Date().toLocaleString('pt-BR')
      });
      // Reabre vaga no lote se estava encerrado
      if (lote.Status === 'Encerrado') {
        dbAtualizar(DB.LOTES, lote.ID_Lote, { Status: 'Aberto' });
      }
      return { ok: true, mensagem: 'Sua inscrição foi cancelada.' };
    }

    if (resposta === 'Confirmado') {
      responderConvite(idConvite, 'Confirmado');
      return { ok: true, mensagem: 'Presença confirmada! Até breve.' };
    }

    return { ok: false, mensagem: 'Resposta inválida.' };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// ------------------------------------------------------------
// LINK INDIVIDUAL DE CONFIRMAÇÃO (tela ConfirmarPresenca.html)
// Acessado via ?pagina=confirmar&token=QR_TOKEN
// Cada convite tem seu próprio QR_Token único.
// ------------------------------------------------------------

/**
 * Retorna os dados do convite para exibição na tela pública individual.
 * Chamado sem login — valida apenas o QR_Token do convite.
 */
function apiInfoConvitePublico(qrToken) {
  try {
    if (!qrToken) return { ok: false, mensagem: 'Link inválido.' };

    const convites = dbListar(DB.CONVITES, c => c.QR_Token === qrToken);
    if (!convites.length) return { ok: false, mensagem: 'Convite não encontrado ou link inválido.' };

    const convite = convites[0];
    if (convite.QR_Valido === 'Não') return { ok: false, mensagem: 'Este link de convite não é mais válido (foi substituído ou cancelado).' };
    if (convite.Status === 'Cancelado') return { ok: false, mensagem: 'Este convite foi cancelado.' };

    const pessoa  = dbBuscarPorId(DB.PESSOAS, convite.ID_Pessoa) || {};
    const evento  = dbBuscarPorId(DB.EVENTOS, convite.ID_Evento) || {};
    const empresa = pessoa.ID_Empresa ? (dbBuscarPorId(DB.EMPRESAS, pessoa.ID_Empresa) || {}) : {};

    return { ok: true, dados: {
      idConvite:  convite.ID_Convite,
      nome:       pessoa.Nome || '—',
      empresa:    empresa.Nome || '',
      cargo:      pessoa.Cargo || '',
      status:     convite.Status,
      evento:     evento.Nome || '—',
      dataEvento: evento.Data ? new Date(evento.Data).toLocaleDateString('pt-BR') : '',
      local:      evento.Local || ''
    }};
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Registra a resposta do convidado (Confirmado ou Recusado) pelo link individual.
 * Chamado sem login — valida apenas o QR_Token do convite.
 */
function apiResponderConvitePublico(qrToken, resposta) {
  try {
    if (!qrToken) return { ok: false, mensagem: 'Link inválido.' };
    if (['Confirmado', 'Recusado'].indexOf(resposta) === -1) return { ok: false, mensagem: 'Resposta inválida.' };

    const convites = dbListar(DB.CONVITES, c => c.QR_Token === qrToken);
    if (!convites.length) return { ok: false, mensagem: 'Convite não encontrado.' };

    const convite = convites[0];
    if (convite.QR_Valido === 'Não') return { ok: false, mensagem: 'Este link não é mais válido.' };
    if (convite.Status === 'Cancelado') return { ok: false, mensagem: 'Este convite foi cancelado.' };
    if (convite.Status === 'Presente')  return { ok: false, mensagem: 'Você já fez check-in no evento!' };

    dbAtualizar(DB.CONVITES, convite.ID_Convite, {
      Status:        resposta,
      Data_Resposta: new Date()
    });

    const msg = resposta === 'Confirmado'
      ? 'Presença confirmada! Te esperamos no evento.'
      : 'Resposta registrada. Obrigado por avisar.';

    return { ok: true, mensagem: msg };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}
