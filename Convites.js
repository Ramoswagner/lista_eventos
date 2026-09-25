/**
 * ============================================================
 * CONVITES.GS - Regras de negócio dos convites
 * ============================================================
 * Operações:
 *  - convidarPessoa / convidarLote
 *  - responderConvite (Confirmado / Recusado)
 *  - substituirConvidado (nunca apaga o original)
 *  - registrarWalkin
 *  - fazerCheckin / fazerCheckinPorQR
 *  - janelaEvento (verifica se check-in está aberto)
 *  - resumoEvento
 * ============================================================
 */

// ------------------------------------------------------------
// JANELA DE CHECK-IN
// Abre no dia do evento; fecha no fim do dia seguinte (+1 dia).
// Admin pode operar fora da janela para correções.
// ------------------------------------------------------------
function janelaEvento(evento) {
  if (!evento || !evento.Data) {
    return { janela: 'sem-data', mensagem: 'Evento sem data definida.', dataFmt: '' };
  }
  const d = new Date(evento.Data);
  if (isNaN(d.getTime())) {
    return { janela: 'sem-data', mensagem: 'Data do evento inválida.', dataFmt: '' };
  }
  const inicio  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fim     = new Date(inicio.getTime() + 2 * 24 * 60 * 60 * 1000 - 1);
  const agora   = new Date();
  const dataFmt = d.toLocaleDateString('pt-BR');

  if (agora < inicio) {
    return { janela: 'antes',  dataFmt, mensagem: 'Este evento acontecerá em ' + dataFmt + '. O check-in abre no dia do evento.' };
  }
  if (agora > fim) {
    return { janela: 'depois', dataFmt, mensagem: 'Este evento já aconteceu (' + dataFmt + '). O check-in está encerrado.' };
  }
  return { janela: 'aberto', dataFmt, mensagem: '' };
}

function _validarJanela(idEvento, sessao) {
  const evento = dbBuscarPorId(DB.EVENTOS, idEvento);
  const j = janelaEvento(evento);
  if (j.janela !== 'aberto' && j.janela !== 'sem-data' && sessao.perfil !== 'Admin') {
    throw new Error(j.mensagem);
  }
  return j;
}

// ------------------------------------------------------------
// CONVIDAR
// Bloqueia duplicidade: mesma pessoa não pode ter dois convites
// "vivos" no mesmo evento (Cancelado/Substituído não contam).
// ------------------------------------------------------------
function convidarPessoa(idEvento, idPessoa, gestor, idLote, obs) {
  if (!dbBuscarPorId(DB.EVENTOS, idEvento)) throw new Error('Evento não encontrado: ' + idEvento);
  if (!dbBuscarPorId(DB.PESSOAS, idPessoa)) throw new Error('Pessoa não encontrada: ' + idPessoa);

  const statusMortos = ['Cancelado', 'Substituído'];
  const jaConvidada = dbListar(DB.CONVITES, c =>
    c.ID_Evento === idEvento && c.ID_Pessoa === idPessoa &&
    statusMortos.indexOf(c.Status) === -1
  );
  if (jaConvidada.length > 0) throw new Error('Esta pessoa já possui convite ativo neste evento.');

  return dbInserir(DB.CONVITES, {
    ID_Evento:   idEvento,
    ID_Pessoa:   idPessoa,
    ID_Lote:     idLote || '',
    Gestor:      gestor || '',
    Status:      'Convidado',
    Origem:      idLote ? 'Lote público' : 'Lista original',
    QR_Token:    Utilities.getUuid(),
    QR_Valido:   'Sim',
    Data_Convite: new Date(),
    Observacoes: obs || ''
  });
}

function convidarLote(idEvento, idsPessoas, gestor) {
  const resultado = { criados: [], erros: [] };
  idsPessoas.forEach(idPessoa => {
    try {
      const convite = convidarPessoa(idEvento, idPessoa, gestor);
      resultado.criados.push(convite.ID_Convite);
    } catch (e) {
      resultado.erros.push({ idPessoa, erro: e.message });
    }
  });
  return resultado;
}

// ------------------------------------------------------------
// RESPOSTA DO CONVIDADO
// ------------------------------------------------------------
function responderConvite(idConvite, resposta) {
  if (['Confirmado', 'Recusado'].indexOf(resposta) === -1) {
    throw new Error('Resposta inválida. Use "Confirmado" ou "Recusado".');
  }
  const convite = dbAtualizar(DB.CONVITES, idConvite, { Status: resposta, Data_Resposta: new Date() });
  if (!convite) throw new Error('Convite não encontrado: ' + idConvite);
  return convite;
}

// ------------------------------------------------------------
// LINK PESSOAL DE CONFIRMAÇÃO — todo convidado (manual, lote ou
// substituição) recebe um link público (pelo próprio QR_Token) para
// confirmar ou recusar presença sozinho, sem precisar de login.
// ------------------------------------------------------------
function apiInfoConvitePublico(qrToken) {
  try {
    const convite = dbListar(DB.CONVITES, c => c.QR_Token === qrToken)[0];
    if (!convite) return { ok: false, mensagem: 'Link inválido.' };
    if (['Cancelado', 'Substituído'].indexOf(convite.Status) !== -1) {
      return { ok: false, mensagem: 'Este convite não está mais ativo.' };
    }
    const evento = dbBuscarPorId(DB.EVENTOS, convite.ID_Evento);
    if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };
    const pessoa = dbBuscarPorId(DB.PESSOAS, convite.ID_Pessoa) || {};
    const empresa = pessoa.ID_Empresa ? dbBuscarPorId(DB.EMPRESAS, pessoa.ID_Empresa) : null;
    return { ok: true, dados: {
      nome: pessoa.Nome || '', empresa: empresa ? empresa.Nome : '',
      evento: evento.Nome, dataEvento: evento.Data ? new Date(evento.Data).toLocaleDateString('pt-BR') : '',
      local: evento.Local || '', status: convite.Status
    } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiResponderConvitePublico(qrToken, resposta) {
  try {
    const convite = dbListar(DB.CONVITES, c => c.QR_Token === qrToken)[0];
    if (!convite) return { ok: false, mensagem: 'Link inválido.' };
    if (convite.Status === 'Presente') return { ok: false, mensagem: 'Você já fez check-in. Não é possível alterar.' };
    if (['Cancelado', 'Substituído'].indexOf(convite.Status) !== -1) return { ok: false, mensagem: 'Este convite não está mais ativo.' };
    responderConvite(convite.ID_Convite, resposta);
    return { ok: true, mensagem: resposta === 'Confirmado' ? 'Presença confirmada! Até breve.' : 'Recebemos sua resposta. Obrigado por avisar.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// SUBSTITUIÇÃO
// O original ganha status Substituído; nasce um convite novo.
// Regra de ouro: nunca editar o convite original para "virar" outra pessoa.
// ------------------------------------------------------------
function substituirConvidado(idConviteOriginal, idNovaPessoa, motivo, autorizadoPor) {
  const original = dbBuscarPorId(DB.CONVITES, idConviteOriginal);
  if (!original) throw new Error('Convite original não encontrado.');
  if (original.Status === 'Substituído') throw new Error('Este convite já foi substituído anteriormente.');
  if (!dbBuscarPorId(DB.PESSOAS, idNovaPessoa)) throw new Error('Nova pessoa não encontrada.');

  dbAtualizar(DB.CONVITES, idConviteOriginal, {
    Status: 'Substituído',
    Motivo_Substituicao: motivo || '',
    Autorizado_Por: autorizadoPor || '',
    QR_Valido: 'Não'
  });

  return dbInserir(DB.CONVITES, {
    ID_Evento:           original.ID_Evento,
    ID_Pessoa:           idNovaPessoa,
    ID_Lote:             original.ID_Lote || '',
    Gestor:              original.Gestor,
    Status:              'Confirmado',
    Origem:              'Substituição',
    ID_Convite_Original: idConviteOriginal,
    Motivo_Substituicao: motivo || '',
    Autorizado_Por:      autorizadoPor || '',
    QR_Token:            Utilities.getUuid(),
    QR_Valido:           'Sim',
    Data_Convite:        new Date()
  });
}

// ------------------------------------------------------------
// WALK-IN — pessoa que aparece sem convite e é autorizada a entrar
// ------------------------------------------------------------
function registrarWalkin(idEvento, opcoes) {
  if (!dbBuscarPorId(DB.EVENTOS, idEvento)) throw new Error('Evento não encontrado.');

  let idPessoa = opcoes.idPessoa;
  if (!idPessoa) {
    if (!opcoes.dadosNovaPessoa || !opcoes.dadosNovaPessoa.Nome) {
      throw new Error('Informe idPessoa ou dadosNovaPessoa.Nome.');
    }
    const nova = dbInserir(DB.PESSOAS, {
      Nome:          opcoes.dadosNovaPessoa.Nome,
      Categoria:     opcoes.dadosNovaPessoa.Categoria || 'Outro',
      Observacoes:   'Cadastro criado no check-in (walk-in)',
      Data_Cadastro: new Date(),
      Ativo:         'Sim'
    });
    idPessoa = nova.ID_Pessoa;
  }

  return dbInserir(DB.CONVITES, {
    ID_Evento:      idEvento,
    ID_Pessoa:      idPessoa,
    Gestor:         '',
    Status:         'Presente',
    Origem:         'Walk-in',
    QR_Token:       Utilities.getUuid(),
    QR_Valido:      'Não',
    Autorizado_Por: opcoes.autorizadoPor || '',
    Data_Convite:   new Date(),
    Checkin_DataHora: new Date(),
    Checkin_Por:    opcoes.checkinPor || '',
    Observacoes:    'Entrada sem convite prévio'
  });
}

// ------------------------------------------------------------
// CHECK-IN
// ------------------------------------------------------------
function fazerCheckin(idConvite, usuario) {
  const convite = dbBuscarPorId(DB.CONVITES, idConvite);
  if (!convite) throw new Error('Convite não encontrado.');
  if (convite.Status === 'Presente') throw new Error('Check-in já realizado para este convite.');
  if (['Cancelado', 'Substituído'].indexOf(convite.Status) !== -1) {
    throw new Error('Convite ' + convite.Status.toLowerCase() + ' não pode fazer check-in.');
  }
  return dbAtualizar(DB.CONVITES, idConvite, {
    Status: 'Presente', Checkin_DataHora: new Date(), Checkin_Por: usuario || ''
  });
}

/**
 * Check-in via QR Code (scanner na porta).
 */
function fazerCheckinPorQR(qrToken, usuario) {
  const convites = dbListar(DB.CONVITES, c => c.QR_Token === qrToken && c.QR_Valido === 'Sim');
  if (!convites.length) throw new Error('QR Code inválido ou não encontrado.');
  return fazerCheckin(convites[0].ID_Convite, usuario);
}

// ------------------------------------------------------------
// RESUMO DO EVENTO
// ------------------------------------------------------------
function resumoEvento(idEvento) {
  const convites  = dbListar(DB.CONVITES, c => c.ID_Evento === idEvento);
  const porStatus = {};
  const porOrigem = {};
  convites.forEach(c => {
    porStatus[c.Status] = (porStatus[c.Status] || 0) + 1;
    porOrigem[c.Origem] = (porOrigem[c.Origem] || 0) + 1;
  });
  const ativos = convites.length - (porStatus['Substituído'] || 0) - (porStatus['Cancelado'] || 0);
  return {
    totalConvites: convites.length,
    ativos,
    porStatus,
    porOrigem,
    taxaPresenca: ativos ? Math.round(100 * (porStatus['Presente'] || 0) / ativos) + '%' : '0%'
  };
}

// ------------------------------------------------------------
// VAGAS DISPONÍVEIS — respeita a capacidade cadastrada no evento.
// disponiveis === null significa evento sem limite de capacidade.
// ------------------------------------------------------------
function _vagasEvento(idEvento) {
  const evento = dbBuscarPorId(DB.EVENTOS, idEvento);
  const capacidade = Number(evento && evento.Capacidade) || 0;
  if (!capacidade) return { capacidade: 0, ativos: 0, disponiveis: null };
  const statusMortos = ['Cancelado', 'Substituído'];
  const ativos = dbContar(DB.CONVITES, c => c.ID_Evento === idEvento && statusMortos.indexOf(c.Status) === -1);
  return { capacidade, ativos, disponiveis: Math.max(0, capacidade - ativos) };
}
