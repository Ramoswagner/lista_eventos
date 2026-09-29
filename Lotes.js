/**
 * ============================================================
 * LOTES.GS - Lotes de convite (grupos / empresas) com link público
 * ============================================================
 * Fluxo:
 *   1. Gestor cria um lote para uma empresa: N vagas e, se tiver, os nºs
 *      dos convites entregues ao grupo (ex.: "101-110").
 *   2. As vagas já entram na lista como "Convidado 1, 2, 3…" da empresa
 *      (cada uma com seu nº) — assim, se a empresa não mandar todos os
 *      nomes, a recepção ainda encontra o grupo pela empresa ou pelo nº.
 *   3. Pelo link público cada pessoa se inscreve com o nº do convite dela
 *      e ocupa aquela vaga; recebe o link pessoal (QR Code da entrada).
 *   4. Depois, pelo mesmo link, confirma ou cancela informando o e-mail
 *      ou o nº do convite + o primeiro nome.
 *
 * CPF não é pedido em lugar nenhum do lote.
 *
 * Status do lote: "Aberto", "Encerrado" (manual) ou "Expirado" (data).
 * Lote lotado continua "Aberto": se alguém cancelar, a vaga volta.
 * ============================================================
 */

// Vagas do lote já com nome (inscritos de verdade).
function _vagasUsadasLote_(idLote) {
  return dbContar_(DB.CONVITES, c => c.ID_Lote === idLote && _conviteAtivo_(c) && !_ehProvisorio_(c));
}

// Vagas reservadas ainda sem nome, na ordem (Convidado 1, 2, 3…).
function _provisoriosDoLote_(idLote) {
  return dbListar_(DB.CONVITES, c => c.ID_Lote === idLote && _conviteAtivo_(c) && _ehProvisorio_(c))
    .sort((a, b) => Number(_s_(a.Nome_Provisorio).replace(/\D/g, '')) - Number(_s_(b.Nome_Provisorio).replace(/\D/g, '')));
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
// dados: { ID_Evento, ID_Empresa, Vagas_Total, Numeros ("101-110"),
//          Reservar (true = vagas entram na lista como Convidado 1…),
//          Data_Expiracao, Observacoes, Gestor }
// ------------------------------------------------------------
function apiCriarLote(token, dados) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    _exigirPermissao_(s, 'lotes', 'criar');
    if (!dados || !dados.ID_Evento) throw new Error('Informe o evento.');
    const numeros = _parseNumeros_(dados.Numeros);
    let vagasTotal = Math.floor(Number(dados.Vagas_Total)) || numeros.length;
    if (!vagasTotal || vagasTotal < 1) throw new Error('Informe o número de vagas (mínimo 1).');
    if (numeros.length > vagasTotal) throw new Error('Foram informados ' + numeros.length + ' nºs de convite para ' + vagasTotal + ' vaga(s).');
    const reservar = dados.Reservar !== false;

    return _comLock_(function() {
      const evento = dbBuscarPorId_(DB.EVENTOS, dados.ID_Evento);
      if (!evento) throw new Error('Evento não encontrado.');
      numeros.forEach(n => _validarNumeroConvite_(dados.ID_Evento, n, null));

      const vg = _vagasEvento_(dados.ID_Evento);
      if (vg.disponiveis !== null && vagasTotal > vg.disponiveis) {
        throw new Error('Esse lote pede ' + vagasTotal + ' vaga(s), mas o evento só tem ' + vg.disponiveis +
          ' disponível(is) (' + vg.ativos + ' de ' + vg.capacidade + ' já ocupadas).');
      }

      const gestor = _gestorResponsavel_(s, dados.Gestor);
      const loteToken = Utilities.getUuid();
      const lote = dbInserir_(DB.LOTES, {
        ID_Evento:       dados.ID_Evento,
        ID_Empresa:      _s_(dados.ID_Empresa),
        Gestor:          gestor,
        Token:           loteToken,
        Vagas_Total:     vagasTotal,
        Status:          'Aberto',
        Data_Expiracao:  dados.Data_Expiracao ? _parseDataLocal_(dados.Data_Expiracao, true) : '',
        Observacoes:     _s_(dados.Observacoes),
        Criado_Em:       new Date(),
        Numeros_Convite: numeros.join(', '),
        Reservar_Vagas:  reservar ? 'Sim' : 'Não'
      });

      // Vagas reservadas na lista: "Convidado 1, 2, 3…" (com o nº, se houver).
      if (reservar) {
        for (let i = 0; i < vagasTotal; i++) {
          dbInserir_(DB.CONVITES, {
            ID_Evento: dados.ID_Evento, ID_Pessoa: '', ID_Lote: lote.ID_Lote, Gestor: gestor,
            Status: 'Convidado', Origem: 'Lote público', QR_Token: Utilities.getUuid(), QR_Valido: 'Sim',
            Data_Convite: new Date(), Nome_Provisorio: 'Convidado ' + (i + 1),
            Numero_Convite: numeros[i] || '', Cadastrado_Por: rotuloSessao_(s)
          });
        }
      }

      logAudit_('INSERT', 'Lotes', lote.ID_Lote, 'Lote criado por ' + rotuloSessao_(s));
      return {
        ok: true,
        mensagem: 'Lote criado' + (reservar ? ' com ' + vagasTotal + ' vaga(s) reservada(s) na lista.' : '.'),
        dados: { id: lote.ID_Lote, link: _urlBase_() + '?pagina=convite&token=' + loteToken, vagas: vagasTotal }
      };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Lista os lotes (com vagas usadas = inscritos com nome).
 */
function apiListarLotes(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;

  const empresas = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);

  const usadas = {}, reservadas = {};
  dbListar_(DB.CONVITES, c => c.ID_Lote && _conviteAtivo_(c)).forEach(c => {
    if (_ehProvisorio_(c)) reservadas[c.ID_Lote] = (reservadas[c.ID_Lote] || 0) + 1;
    else usadas[c.ID_Lote] = (usadas[c.ID_Lote] || 0) + 1;
  });

  const lotes = idEvento ? dbListar_(DB.LOTES, l => l.ID_Evento === idEvento) : dbListar_(DB.LOTES);
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
      semNome:      reservadas[l.ID_Lote] || 0,
      vagasLivres:  Math.max(0, total - vagasUsadas),
      numeros:      _s_(l.Numeros_Convite),
      status:       _statusLote_(l),
      expiracao:    _fmtData_(l.Data_Expiracao),
      obs:          _s_(l.Observacoes)
    };
  }) };
}

function apiEncerrarLote(token, idLote) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    _exigirPermissao_(s, 'lotes', 'editar');
    const lote = dbBuscarPorId_(DB.LOTES, idLote);
    if (!lote) throw new Error('Lote não encontrado.');
    dbAtualizar_(DB.LOTES, idLote, { Status: 'Encerrado' });
    return { ok: true, mensagem: 'Lote encerrado. As vagas sem nome continuam na lista como "Convidado N".' };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

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
    const inscritos = dbListar_(DB.CONVITES, c => c.ID_Lote === lote.ID_Lote && _conviteAtivo_(c) && !_ehProvisorio_(c))
      .map(c => {
        const p = pessoas[c.ID_Pessoa] || {};
        // sem nº do convite: nº + primeiro nome é a chave para gerenciar a inscrição
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
      exigeNumero: !!_s_(lote.Numeros_Convite),
      inscricaoAberta: !motivoFechado,
      motivoFechado,
      inscritos
    } };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Inscrição pública: dadosPessoa { Nome, Numero, Email, Telefone, Cargo }.
 * Ocupa a vaga reservada do nº informado (ou a próxima vaga livre).
 */
function apiInscreverNoLote(loteToken, dadosPessoa) {
  try {
    dadosPessoa = dadosPessoa || {};
    const nome = _s_(dadosPessoa.Nome).replace(/\s+/g, ' ');
    if (nome.length < 3) return { ok: false, mensagem: 'Informe seu nome completo.' };
    const email = _s_(dadosPessoa.Email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, mensagem: 'E-mail inválido.' };
    const numero = _normNumero_(dadosPessoa.Numero);
    if (!numero && !email) return { ok: false, mensagem: 'Informe o nº do seu convite ou o seu e-mail (usado para confirmar ou cancelar depois).' };

    return _comLock_(function() {
      const lote = _lotePorToken_(loteToken);
      if (!lote) return { ok: false, mensagem: 'Link inválido.' };
      if (_statusLote_(lote) !== 'Aberto') return { ok: false, mensagem: 'As inscrições deste lote não estão abertas.' };
      if (_vagasUsadasLote_(lote.ID_Lote) >= Number(lote.Vagas_Total)) {
        return { ok: false, mensagem: 'Todas as vagas deste lote já foram preenchidas.' };
      }

      const numerosLote = _s_(lote.Numeros_Convite) ? _parseNumeros_(lote.Numeros_Convite) : [];
      if (numerosLote.length) {
        if (!numero) return { ok: false, mensagem: 'Informe o nº impresso no seu convite.' };
        if (numerosLote.indexOf(numero) === -1) return { ok: false, mensagem: 'O convite nº ' + numero + ' não pertence a este grupo. Confira o número.' };
      }

      // Vaga reservada: a do nº informado ou a próxima sem nome.
      const provisorios = _provisoriosDoLote_(lote.ID_Lote);
      let vaga = numero ? provisorios.filter(c => _normNumero_(c.Numero_Convite) === numero)[0] : null;
      if (numero && !vaga) {
        const dono = dbListar_(DB.CONVITES, c => c.ID_Evento === lote.ID_Evento && _conviteAtivo_(c) && _normNumero_(c.Numero_Convite) === numero)[0];
        if (dono) return { ok: false, mensagem: 'O convite nº ' + numero + ' já foi usado numa inscrição. Se for o seu, fale com quem te convidou.' };
      }
      if (!vaga) vaga = provisorios.filter(c => !_s_(c.Numero_Convite))[0] || null;

      if (!vaga) {
        const vg = _vagasEvento_(lote.ID_Evento);
        if (vg.disponiveis !== null && vg.disponiveis < 1) return { ok: false, mensagem: 'O evento atingiu a capacidade máxima.' };
      }

      // Reaproveita o cadastro pelo e-mail (sem CPF).
      const existente = email ? dbListar_(DB.PESSOAS, p => _s_(p.Email).toLowerCase() === email)[0] : null;
      let idPessoa = existente ? existente.ID_Pessoa : null;
      if (idPessoa) {
        const jaInscrito = dbListar_(DB.CONVITES, c => c.ID_Evento === lote.ID_Evento && c.ID_Pessoa === idPessoa && _conviteAtivo_(c));
        if (jaInscrito.length) return { ok: false, mensagem: 'Este e-mail já tem inscrição neste evento.' };
      } else {
        idPessoa = dbInserir_(DB.PESSOAS, {
          Nome: nome, Telefone: _s_(dadosPessoa.Telefone), Email: email, Cargo: _s_(dadosPessoa.Cargo),
          ID_Empresa: _s_(lote.ID_Empresa), Categoria: 'Outro', Observacoes: 'Cadastro via lote público',
          Gestor_Responsavel: _s_(lote.Gestor), Data_Cadastro: new Date(), Ativo: 'Sim'
        }).ID_Pessoa;
      }

      let convite;
      if (vaga) {
        dbAtualizar_(DB.CONVITES, vaga.ID_Convite, { ID_Pessoa: idPessoa, Nome_Provisorio: '', Numero_Convite: numero || vaga.Numero_Convite || '' });
        convite = dbBuscarPorId_(DB.CONVITES, vaga.ID_Convite);
      } else {
        const n = _validarNumeroConvite_(lote.ID_Evento, numero, null);
        convite = convidarPessoa_(lote.ID_Evento, idPessoa, lote.Gestor, lote.ID_Lote);
        if (n) dbAtualizar_(DB.CONVITES, convite.ID_Convite, { Numero_Convite: n });
      }

      return {
        ok: true,
        mensagem: 'Inscrição realizada com sucesso! Você está na lista.',
        dados: { linkPessoal: _linkConfirmacao_(convite.QR_Token), numero: _normNumero_(convite.Numero_Convite) }
      };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// Acha a inscrição deste lote pelo e-mail, ou pelo nº do convite + primeiro nome.
function _inscricaoPorBusca_(lote, busca, primeiroNome) {
  const b = _s_(busca).toLowerCase();
  if (!b) return null;
  const pessoas = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  const ehEmail = b.indexOf('@') !== -1;
  const numero = _normNumero_(busca);
  const nome1 = _s_(primeiroNome).toLowerCase().split(' ')[0];
  return dbListar_(DB.CONVITES, c => c.ID_Lote === lote.ID_Lote && _conviteAtivo_(c) && !_ehProvisorio_(c)).filter(c => {
    const p = pessoas[c.ID_Pessoa] || {};
    if (ehEmail) return _s_(p.Email).toLowerCase() === b;
    return nome1.length >= 2 && _normNumero_(c.Numero_Convite) === numero &&
      _s_(p.Nome).toLowerCase().split(' ')[0] === nome1;
  }).map(c => ({ convite: c, pessoa: pessoas[c.ID_Pessoa] || {} }))[0] || null;
}

function apiBuscarInscricaoLote(loteToken, busca, primeiroNome) {
  try {
    const lote = _lotePorToken_(loteToken);
    if (!lote) return { ok: false, mensagem: 'Link inválido.' };
    const achou = _inscricaoPorBusca_(lote, busca, primeiroNome);
    if (!achou) return { ok: false, mensagem: 'Nenhuma inscrição encontrada. Confira o e-mail, ou o nº do convite e o seu primeiro nome.' };
    return { ok: true, dados: {
      nome:   _s_(achou.pessoa.Nome),
      cargo:  _s_(achou.pessoa.Cargo),
      status: _s_(achou.convite.Status),
      numero: _normNumero_(achou.convite.Numero_Convite)
    } };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

/**
 * Confirmação/cancelamento pelo link público. Cancelar devolve a vaga
 * ao grupo (volta a "Convidado N" se o lote reservou vagas).
 */
function apiResponderPorLote(loteToken, busca, resposta, primeiroNome) {
  try {
    if (['Confirmado', 'Cancelado'].indexOf(resposta) === -1) return { ok: false, mensagem: 'Resposta inválida.' };
    return _comLock_(function() {
      const lote = _lotePorToken_(loteToken);
      if (!lote) return { ok: false, mensagem: 'Link inválido.' };
      const achou = _inscricaoPorBusca_(lote, busca, primeiroNome);
      if (!achou) return { ok: false, mensagem: 'Nenhuma inscrição encontrada com estes dados.' };
      const convite = achou.convite;
      if (convite.Status === 'Presente') return { ok: false, mensagem: 'Você já fez check-in. Não é possível alterar.' };

      if (resposta === 'Cancelado') {
        dbAtualizar_(DB.CONVITES, convite.ID_Convite, {
          Status: 'Cancelado', QR_Valido: 'Não',
          Observacoes: (convite.Observacoes ? _s_(convite.Observacoes) + ' | ' : '') +
                       'Cancelado pelo próprio inscrito em ' + _fmtData_(new Date(), 'dd/MM/yyyy HH:mm')
        });
        // Se o lote trabalha com vagas reservadas, a vaga volta como "Convidado N"
        // (com o mesmo nº e a mesma mesa), pronta para outra pessoa do grupo.
        if (lote.Reservar_Vagas === 'Sim') {
          const nomes = dbListar_(DB.CONVITES, c => c.ID_Lote === lote.ID_Lote && _ehProvisorio_(c) && _conviteAtivo_(c)).map(c => _s_(c.Nome_Provisorio));
          let i = 1; while (nomes.indexOf('Convidado ' + i) !== -1) i++;
          dbInserir_(DB.CONVITES, {
            ID_Evento: lote.ID_Evento, ID_Pessoa: '', ID_Lote: lote.ID_Lote, Gestor: lote.Gestor,
            Status: 'Convidado', Origem: 'Lote público', QR_Token: Utilities.getUuid(), QR_Valido: 'Sim',
            Data_Convite: new Date(), Nome_Provisorio: 'Convidado ' + i, Numero_Convite: convite.Numero_Convite || '',
            ID_Mesa: convite.ID_Mesa || ''
          });
          // o nº volta para a vaga reservada
          dbAtualizar_(DB.CONVITES, convite.ID_Convite, { Numero_Convite: '' });
        }
        return { ok: true, mensagem: 'Sua inscrição foi cancelada.' };
      }

      responderConvite_(convite.ID_Convite, 'Confirmado');
      return { ok: true, mensagem: 'Presença confirmada! Até breve.' };
    });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}
