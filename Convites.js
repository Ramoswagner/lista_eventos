/**
 * ============================================================
 * CONVITES.GS - Regras de negócio dos convites
 * ============================================================
 * Operações:
 *  - convidarPessoa_ / convidarLote_
 *  - responderConvite_ (Confirmado / Recusado)
 *  - apiInfoConvitePublico / apiResponderConvitePublico (link pessoal)
 *  - substituirConvidado_ (nunca apaga o original)
 *  - registrarWalkin_
 *  - fazerCheckin_ / fazerCheckinPorQR_
 *  - janelaEvento_ (verifica se check-in está aberto)
 *  - resumoEvento_ / _vagasEvento_
 * ============================================================
 */

const STATUS_INATIVOS = ['Cancelado', 'Substituído'];
function _conviteAtivo_(c) { return STATUS_INATIVOS.indexOf(c.Status) === -1; }

// ------------------------------------------------------------
// JANELA DE CHECK-IN
// Abre no dia do evento; fecha no fim do dia seguinte (+1 dia).
// Admin pode operar fora da janela para correções.
// ------------------------------------------------------------
function janelaEvento_(evento) {
  if (!evento || !evento.Data) {
    return { janela: 'sem-data', mensagem: 'Evento sem data definida.', dataFmt: '' };
  }
  const d = new Date(evento.Data);
  if (isNaN(d.getTime())) {
    return { janela: 'sem-data', mensagem: 'Data do evento inválida.', dataFmt: '' };
  }
  // Compara só o dia (yyyyMMdd) no fuso do sistema.
  const diaEvento = Number(_fmtData_(d, 'yyyyMMdd'));
  const diaSeguinte = Number(_fmtData_(new Date(d.getTime() + 24 * 60 * 60 * 1000), 'yyyyMMdd'));
  const hoje = Number(_fmtData_(new Date(), 'yyyyMMdd'));
  const dataFmt = _fmtData_(d);

  if (hoje < diaEvento) {
    return { janela: 'antes',  dataFmt, mensagem: 'Este evento acontecerá em ' + dataFmt + '. O check-in abre no dia do evento.' };
  }
  if (hoje > diaSeguinte) {
    return { janela: 'depois', dataFmt, mensagem: 'Este evento já aconteceu (' + dataFmt + '). O check-in está encerrado.' };
  }
  return { janela: 'aberto', dataFmt, mensagem: '' };
}

function _validarJanela_(idEvento, sessao) {
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!evento) throw new Error('Evento não encontrado.');
  const j = janelaEvento_(evento);
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
function convidarPessoa_(idEvento, idPessoa, gestor, idLote, obs) {
  return _comLock_(function() {
    if (!dbBuscarPorId_(DB.EVENTOS, idEvento)) throw new Error('Evento não encontrado.');
    if (!dbBuscarPorId_(DB.PESSOAS, idPessoa)) throw new Error('Pessoa não encontrada.');

    const jaConvidada = dbListar_(DB.CONVITES, c =>
      c.ID_Evento === idEvento && c.ID_Pessoa === idPessoa && _conviteAtivo_(c)
    );
    if (jaConvidada.length > 0) throw new Error('Esta pessoa já possui convite ativo neste evento.');

    return dbInserir_(DB.CONVITES, {
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
  });
}

function convidarLote_(idEvento, idsPessoas, gestor) {
  const resultado = { criados: [], erros: [] };
  idsPessoas.forEach(idPessoa => {
    try {
      const convite = convidarPessoa_(idEvento, idPessoa, gestor);
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
function responderConvite_(idConvite, resposta) {
  if (['Confirmado', 'Recusado'].indexOf(resposta) === -1) {
    throw new Error('Resposta inválida. Use "Confirmado" ou "Recusado".');
  }
  const convite = dbAtualizar_(DB.CONVITES, idConvite, { Status: resposta, Data_Resposta: new Date() });
  if (!convite) throw new Error('Convite não encontrado.');
  return convite;
}

// ------------------------------------------------------------
// LINK PESSOAL DE CONFIRMAÇÃO (tela ConfirmarPresenca.html)
// Acessado via ?pagina=confirmar&token=QR_TOKEN — sem login.
// Todo convidado (manual, lote ou substituição) tem o seu.
// ------------------------------------------------------------
function _convitePorQR_(qrToken) {
  const t = _s_(qrToken);
  if (!t) return null;
  return dbListar_(DB.CONVITES, c => _s_(c.QR_Token) === t)[0] || null;
}

function apiInfoConvitePublico(qrToken) {
  try {
    const convite = _convitePorQR_(qrToken);
    if (!convite) return { ok: false, mensagem: 'Link inválido ou convite não encontrado.' };
    if (convite.QR_Valido === 'Não' || !_conviteAtivo_(convite)) {
      return { ok: false, mensagem: 'Este convite não está mais ativo (foi substituído ou cancelado).' };
    }
    const evento = dbBuscarPorId_(DB.EVENTOS, convite.ID_Evento);
    if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' };
    const pessoa  = dbBuscarPorId_(DB.PESSOAS, convite.ID_Pessoa) || {};
    const empresa = pessoa.ID_Empresa ? dbBuscarPorId_(DB.EMPRESAS, pessoa.ID_Empresa) : null;
    return { ok: true, dados: {
      nome:       _s_(pessoa.Nome),
      empresa:    empresa ? _s_(empresa.Nome) : '',
      evento:     _s_(evento.Nome),
      dataEvento: _fmtData_(evento.Data),
      local:      _s_(evento.Local),
      status:     _s_(convite.Status),
      categorias: DB.PESSOAS.validacoes.Categoria
    } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiResponderConvitePublico(qrToken, resposta) {
  try {
    if (['Confirmado', 'Recusado'].indexOf(resposta) === -1) return { ok: false, mensagem: 'Resposta inválida.' };
    return _comLock_(function() {
      const convite = _convitePorQR_(qrToken);
      if (!convite) return { ok: false, mensagem: 'Link inválido.' };
      if (convite.QR_Valido === 'Não' || !_conviteAtivo_(convite)) return { ok: false, mensagem: 'Este convite não está mais ativo.' };
      if (convite.Status === 'Presente') return { ok: false, mensagem: 'Você já fez check-in. Não é possível alterar.' };
      responderConvite_(convite.ID_Convite, resposta);
      return { ok: true, mensagem: resposta === 'Confirmado'
        ? 'Presença confirmada! Te esperamos no evento.'
        : 'Resposta registrada. Obrigado por avisar.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// ATUALIZAÇÃO DE DADOS PELO PRÓPRIO CONVIDADO (link pessoal)
// Opcional: o convidado preenche só o que quer atualizar (ex.: trocou
// de telefone). Os dados atuais NUNCA são enviados para a página — ele
// vê apenas o próprio nome. Campo vazio = não mexe no que já existe.
// ------------------------------------------------------------
const CAMPOS_ATUALIZAVEIS = ['Nome', 'Email', 'Documento', 'Telefone', 'Cargo', 'Categoria'];

function apiAtualizarMeusDados(qrToken, dados) {
  try {
    if (!dados || typeof dados !== 'object') return { ok: false, mensagem: 'Nada para atualizar.' };
    const t = _s_(qrToken);
    if (!t) return { ok: false, mensagem: 'Link inválido.' };

    // Limite: 10 atualizações por hora por link (evita abuso do link público).
    const cache = CacheService.getScriptCache();
    const chaveLimite = 'atualiza_' + t;
    const usos = Number(cache.get(chaveLimite) || 0);
    if (usos >= 10) return { ok: false, mensagem: 'Muitas alterações seguidas. Tente de novo mais tarde.' };

    const novos = {};
    const nome = _s_(dados.Nome).replace(/\s+/g, ' ');
    if (nome) {
      if (nome.length < 3 || nome.length > 120) throw new Error('Informe o nome completo (3 a 120 letras).');
      novos.Nome = nome;
    }
    const email = _s_(dados.Email).toLowerCase();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new Error('E-mail inválido.');
      novos.Email = email;
    }
    const doc = _s_(dados.Documento);
    if (doc) {
      const digitos = _soDigitos_(doc);
      if (digitos.length < 5 || digitos.length > 20) throw new Error('Documento inválido.');
      novos.Documento = doc.slice(0, 30);
    }
    const tel = _s_(dados.Telefone);
    if (tel) {
      const digitos = _soDigitos_(tel);
      if (digitos.length < 8 || digitos.length > 15) throw new Error('Telefone inválido (inclua o DDD).');
      novos.Telefone = tel.slice(0, 25);
    }
    const cargo = _s_(dados.Cargo);
    if (cargo) novos.Cargo = cargo.slice(0, 80);
    const cat = _s_(dados.Categoria);
    if (cat) {
      if (DB.PESSOAS.validacoes.Categoria.indexOf(cat) === -1) throw new Error('Opção inválida em "Quem é você".');
      novos.Categoria = cat;
    }
    if (!Object.keys(novos).length) return { ok: false, mensagem: 'Preencha pelo menos um campo para atualizar.' };

    return _comLock_(function() {
      const convite = _convitePorQR_(t);
      if (!convite || convite.QR_Valido === 'Não' || !_conviteAtivo_(convite)) {
        return { ok: false, mensagem: 'Este convite não está mais ativo.' };
      }
      const pessoa = dbBuscarPorId_(DB.PESSOAS, convite.ID_Pessoa);
      if (!pessoa) return { ok: false, mensagem: 'Cadastro não encontrado. Fale com a organização.' };

      if (novos.Documento) {
        const outro = _pessoaPorDocumento_(novos.Documento);
        if (outro && outro.ID_Pessoa !== pessoa.ID_Pessoa) {
          return { ok: false, mensagem: 'Este documento já está em outro cadastro. Fale com a organização do evento.' };
        }
      }

      dbAtualizar_(DB.PESSOAS, pessoa.ID_Pessoa, novos);
      cache.put(chaveLimite, String(usos + 1), 3600);
      // Registra QUAIS campos mudaram (não os valores).
      logAudit_('UPDATE', 'Pessoas', pessoa.ID_Pessoa, 'Dados atualizados pelo próprio convidado: ' + Object.keys(novos).join(', '));
      return { ok: true, mensagem: 'Dados atualizados. Obrigado!', dados: { nome: novos.Nome || _s_(pessoa.Nome) } };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// SUBSTITUIÇÃO
// O original ganha status Substituído; nasce um convite novo.
// Regra de ouro: nunca editar o convite original para "virar" outra pessoa.
// ------------------------------------------------------------
function substituirConvidado_(idConviteOriginal, idNovaPessoa, motivo, autorizadoPor) {
  return _comLock_(function() {
    const original = dbBuscarPorId_(DB.CONVITES, idConviteOriginal);
    if (!original) throw new Error('Convite original não encontrado.');
    if (original.Status === 'Substituído') throw new Error('Este convite já foi substituído anteriormente.');
    if (original.Status === 'Cancelado')   throw new Error('Este convite está cancelado e não pode ser substituído.');
    if (original.Status === 'Presente')    throw new Error('O convidado original já entrou; não é possível substituí-lo.');
    if (!dbBuscarPorId_(DB.PESSOAS, idNovaPessoa)) throw new Error('Nova pessoa não encontrada.');

    dbAtualizar_(DB.CONVITES, idConviteOriginal, {
      Status: 'Substituído',
      Motivo_Substituicao: motivo || '',
      Autorizado_Por: autorizadoPor || '',
      QR_Valido: 'Não'
    });

    return dbInserir_(DB.CONVITES, {
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
      Data_Convite:        new Date(),
      ID_Mesa:             original.ID_Mesa || ''   // o substituto senta no lugar do original
    });
  });
}

// ------------------------------------------------------------
// WALK-IN — pessoa que aparece sem convite e é autorizada a entrar
// ------------------------------------------------------------
function registrarWalkin_(idEvento, opcoes) {
  if (!dbBuscarPorId_(DB.EVENTOS, idEvento)) throw new Error('Evento não encontrado.');

  let idPessoa = opcoes.idPessoa;
  if (!idPessoa) {
    if (!opcoes.dadosNovaPessoa || !opcoes.dadosNovaPessoa.Nome) {
      throw new Error('Informe idPessoa ou dadosNovaPessoa.Nome.');
    }
    const nova = dbInserir_(DB.PESSOAS, {
      Nome:          opcoes.dadosNovaPessoa.Nome,
      Categoria:     opcoes.dadosNovaPessoa.Categoria || 'Outro',
      Observacoes:   'Cadastro criado no check-in (walk-in)',
      Data_Cadastro: new Date(),
      Ativo:         'Sim'
    });
    idPessoa = nova.ID_Pessoa;
  }

  return dbInserir_(DB.CONVITES, {
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
function fazerCheckin_(idConvite, usuario) {
  return _comLock_(function() {
    const convite = dbBuscarPorId_(DB.CONVITES, idConvite);
    if (!convite) throw new Error('Convite não encontrado.');
    if (convite.Status === 'Presente') {
      throw new Error('Check-in já realizado' + (convite.Checkin_DataHora ? ' às ' + _fmtData_(convite.Checkin_DataHora, 'HH:mm') : '') + '.');
    }
    if (!_conviteAtivo_(convite)) {
      throw new Error('Convite ' + convite.Status.toLowerCase() + ' não pode fazer check-in.');
    }
    if (convite.Status === 'Recusado') {
      // Convidado tinha recusado mas apareceu: libera, registrando no histórico.
      convite.Observacoes = (convite.Observacoes ? _s_(convite.Observacoes) + ' | ' : '') + 'Havia recusado, mas compareceu';
    }
    return dbAtualizar_(DB.CONVITES, idConvite, {
      Status: 'Presente', Checkin_DataHora: new Date(), Checkin_Por: usuario || '',
      Observacoes: convite.Observacoes || ''
    });
  });
}

// O QR pode conter só o token ou o link pessoal inteiro (…?pagina=confirmar&token=XYZ).
function _extrairTokenQR_(conteudo) {
  const t = _s_(conteudo);
  const m = t.match(/[?&]token=([A-Za-z0-9-]+)/);
  return m ? m[1] : t;
}

/**
 * Check-in via QR Code (scanner na porta).
 * Se idEvento vier, recusa QR de outro evento.
 */
function fazerCheckinPorQR_(conteudoQR, usuario, idEvento, sessao) {
  const qrToken = _extrairTokenQR_(conteudoQR);
  const convite = _convitePorQR_(qrToken);
  if (!convite || convite.QR_Valido !== 'Sim') throw new Error('QR Code inválido ou não encontrado.');
  if (idEvento && convite.ID_Evento !== idEvento) throw new Error('Este QR Code é de outro evento.');
  if (sessao) _validarJanela_(convite.ID_Evento, sessao);
  return fazerCheckin_(convite.ID_Convite, usuario);
}

// ------------------------------------------------------------
// RESUMO DO EVENTO
// ------------------------------------------------------------
function resumoEvento_(idEvento) {
  const convites  = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento);
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
function _vagasEvento_(idEvento) {
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  const capacidade = Number(evento && evento.Capacidade) || 0;
  const ativos = dbContar_(DB.CONVITES, c => c.ID_Evento === idEvento && _conviteAtivo_(c));
  return {
    capacidade:  capacidade,
    ativos:      ativos,
    disponiveis: capacidade > 0 ? Math.max(0, capacidade - ativos) : null
  };
}
