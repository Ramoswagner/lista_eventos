/**
 * ============================================================
 * MESAS.GS - Mapa de mesas do evento
 * ============================================================
 * Cada mesa pertence a um evento e tem número, nome opcional
 * ("Diretoria"), formato (Redonda/Retangular), lugares, VIP e posição
 * na planta (Pos_X/Pos_Y numa área lógica de 1000 x 640).
 * O convidado fica numa mesa pela coluna ID_Mesa do convite.
 *
 * Só convites ativos ocupam lugar (Convidado, Confirmado, Presente):
 * cancelado, substituído ou recusado liberam a cadeira sozinhos.
 * ============================================================
 */

const PLANTA = { LARGURA: 1000, ALTURA: 640 };
const STATUS_SENTAM = ['Convidado', 'Confirmado', 'Presente'];
// Autoridades e apoiadores vão primeiro para as mesas VIP na distribuição automática.
const CATEGORIAS_VIP = ['Deputado', 'Senador', 'Prefeito', 'Vereador', 'Secretário', 'Político', 'Patrocinador', 'Conselheiro', 'Doador'];

function _ocupaLugar_(c) { return STATUS_SENTAM.indexOf(c.Status) !== -1; }

function _rotuloMesa_(m) {
  if (!m) return '';
  const nome = _s_(m.Nome);
  return nome ? nome + ' (' + _s_(m.Numero) + ')' : 'Mesa ' + _s_(m.Numero);
}

function _mesaParaCliente_(m, ocupados) {
  return {
    id:         m.ID_Mesa,
    numero:     Number(m.Numero) || 0,
    nome:       _s_(m.Nome),
    rotulo:     _rotuloMesa_(m),
    capacidade: Number(m.Capacidade) || 0,
    formato:    _s_(m.Formato) || 'Redonda',
    vip:        m.VIP === 'Sim',
    x:          Number(m.Pos_X) || 0,
    y:          Number(m.Pos_Y) || 0,
    obs:        _s_(m.Observacoes),
    ocupados:   ocupados || 0
  };
}

function _mesasDoEvento_(idEvento) {
  return dbListar_(DB.MESAS, m => m.ID_Evento === idEvento)
    .sort((a, b) => (Number(a.Numero) || 0) - (Number(b.Numero) || 0));
}

// { ID_Mesa: quantidade de lugares ocupados }
function _ocupacaoMesas_(idEvento) {
  const oc = {};
  dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento && c.ID_Mesa && _ocupaLugar_(c))
    .forEach(c => { oc[c.ID_Mesa] = (oc[c.ID_Mesa] || 0) + 1; });
  return oc;
}

// Mapa ID_Mesa → rótulo, usado na lista de convidados, check-in e relatórios.
function _rotulosMesas_(idEvento) {
  const r = {};
  dbListar_(DB.MESAS, m => m.ID_Evento === idEvento).forEach(m => { r[m.ID_Mesa] = _rotuloMesa_(m); });
  return r;
}

// ------------------------------------------------------------
// LEITURA
// ------------------------------------------------------------
function apiMesasEvento(token, idEvento) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
    if (!evento) throw new Error('Evento não encontrado.');
    const oc = _ocupacaoMesas_(idEvento);
    const mesas = _mesasDoEvento_(idEvento).map(m => _mesaParaCliente_(m, oc[m.ID_Mesa]));
    const idsMesas = {};
    mesas.forEach(m => { idsMesas[m.id] = true; });

    const pessoas = {}, empresas = {};
    dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
    dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
    const convidados = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento && _ocupaLugar_(c)).map(c => {
      const p = pessoas[c.ID_Pessoa] || {};
      return {
        idConvite: c.ID_Convite,
        nome:      _s_(p.Nome) || '(sem nome)',
        empresa:   _s_(empresas[p.ID_Empresa]),
        categoria: _s_(p.Categoria),
        gestor:    _s_(c.Gestor),
        status:    _s_(c.Status),
        idMesa:    idsMesas[c.ID_Mesa] ? c.ID_Mesa : ''
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const lugares = mesas.reduce((t, m) => t + m.capacidade, 0);
    const sentados = convidados.filter(c => c.idMesa).length;
    return { ok: true, dados: {
      evento: { id: evento.ID_Evento, nome: _s_(evento.Nome) },
      mesas: mesas,
      convidados: convidados,
      resumo: { mesas: mesas.length, lugares: lugares, sentados: sentados, semMesa: convidados.length - sentados, livres: Math.max(0, lugares - sentados) },
      podeEditar: temPermissao_(s.perfil, 'mesas', 'editar'),
      planta: PLANTA
    } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CRIAR / EDITAR / MOVER / EXCLUIR
// ------------------------------------------------------------
// Próximas posições livres numa grade, sem encostar nas mesas existentes.
function _posicoesLivres_(existentes, quantidade) {
  const passoX = 170, passoY = 150, margem = 95;
  const livres = [];
  for (let y = margem; y <= PLANTA.ALTURA - 70 && livres.length < quantidade; y += passoY) {
    for (let x = margem; x <= PLANTA.LARGURA - 80 && livres.length < quantidade; x += passoX) {
      const ocupado = existentes.concat(livres).some(p => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 110);
      if (!ocupado) livres.push({ x: x, y: y });
    }
  }
  // Planta cheia: empilha em cascata a partir do canto (o usuário arrasta depois).
  while (livres.length < quantidade) {
    const n = livres.length;
    livres.push({ x: 80 + (n * 24) % 400, y: 80 + (n * 18) % 300 });
  }
  return livres;
}

function _validarCapacidade_(v) {
  const n = Math.floor(Number(v));
  if (!n || n < 1 || n > 60) throw new Error('Lugares por mesa: de 1 a 60.');
  return n;
}

function apiCriarMesas(token, idEvento, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    dados = dados || {};
    const qtd = Math.floor(Number(dados.quantidade) || 1);
    if (qtd < 1 || qtd > 100) throw new Error('Quantidade de mesas: de 1 a 100.');
    const cap = _validarCapacidade_(dados.capacidade || 8);
    const formato = dados.formato === 'Retangular' ? 'Retangular' : 'Redonda';
    return _comLock_(function() {
      if (!dbBuscarPorId_(DB.EVENTOS, idEvento)) throw new Error('Evento não encontrado.');
      const existentes = _mesasDoEvento_(idEvento);
      let numero = existentes.reduce((mx, m) => Math.max(mx, Number(m.Numero) || 0), 0);
      const posicoes = _posicoesLivres_(existentes.map(m => ({ x: Number(m.Pos_X) || 0, y: Number(m.Pos_Y) || 0 })), qtd);
      for (let i = 0; i < qtd; i++) {
        numero++;
        dbInserir_(DB.MESAS, {
          ID_Evento: idEvento, Numero: numero, Capacidade: cap,
          VIP: dados.vip ? 'Sim' : 'Não', Formato: formato,
          Nome: qtd === 1 ? _s_(dados.nome).slice(0, 40) : '',
          Pos_X: posicoes[i].x, Pos_Y: posicoes[i].y, Observacoes: ''
        });
      }
      return { ok: true, mensagem: qtd === 1 ? 'Mesa ' + numero + ' criada.' : qtd + ' mesas criadas.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiEditarMesa(token, idMesa, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    dados = dados || {};
    return _comLock_(function() {
      const m = dbBuscarPorId_(DB.MESAS, idMesa);
      if (!m) throw new Error('Mesa não encontrada.');
      const numero = Math.floor(Number(dados.numero));
      if (!numero || numero < 1 || numero > 9999) throw new Error('Número da mesa inválido.');
      const repetida = _mesasDoEvento_(m.ID_Evento).some(x => x.ID_Mesa !== idMesa && Number(x.Numero) === numero);
      if (repetida) throw new Error('Já existe uma mesa com o número ' + numero + ' neste evento.');
      const cap = _validarCapacidade_(dados.capacidade);
      const ocupados = _ocupacaoMesas_(m.ID_Evento)[idMesa] || 0;
      if (cap < ocupados) throw new Error('Há ' + ocupados + ' pessoa(s) nesta mesa. Retire alguém antes de reduzir para ' + cap + ' lugar(es).');
      dbAtualizar_(DB.MESAS, idMesa, {
        Numero: numero, Capacidade: cap, Nome: _s_(dados.nome).slice(0, 40),
        Formato: dados.formato === 'Retangular' ? 'Retangular' : 'Redonda',
        VIP: dados.vip ? 'Sim' : 'Não', Observacoes: _s_(dados.obs).slice(0, 200)
      });
      return { ok: true, mensagem: 'Mesa atualizada.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// posicoes: [{ id, x, y }] — salva a planta depois de arrastar (uma gravação só).
function apiMoverMesas(token, posicoes) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    const mudancas = {};
    (posicoes || []).slice(0, 200).forEach(p => {
      const x = Math.round(Math.min(PLANTA.LARGURA - 20, Math.max(20, Number(p.x) || 0)));
      const y = Math.round(Math.min(PLANTA.ALTURA - 20, Math.max(20, Number(p.y) || 0)));
      if (p.id) mudancas[_s_(p.id)] = { Pos_X: x, Pos_Y: y };
    });
    dbAtualizarVarios_(DB.MESAS, mudancas);
    return { ok: true };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiExcluirMesa(token, idMesa) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    return _comLock_(function() {
      const m = dbBuscarPorId_(DB.MESAS, idMesa);
      if (!m) throw new Error('Mesa não encontrada.');
      const liberar = {};
      dbListar_(DB.CONVITES, c => c.ID_Mesa === idMesa).forEach(c => { liberar[c.ID_Convite] = { ID_Mesa: '' }; });
      dbAtualizarVarios_(DB.CONVITES, liberar);
      dbExcluir_(DB.MESAS, idMesa);
      const n = Object.keys(liberar).length;
      return { ok: true, mensagem: _rotuloMesa_(m) + ' excluída' + (n ? '; ' + n + ' convidado(s) ficaram sem mesa.' : '.') };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// ATRIBUIR CONVIDADOS
// idMesa vazio = tirar da mesa.
// ------------------------------------------------------------
function apiAtribuirMesa(token, idEvento, idsConvites, idMesa) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    const ids = (idsConvites || []).map(_s_).filter(Boolean);
    if (!ids.length) throw new Error('Selecione pelo menos um convidado.');
    return _comLock_(function() {
      let mesa = null;
      if (idMesa) {
        mesa = dbBuscarPorId_(DB.MESAS, idMesa);
        if (!mesa || mesa.ID_Evento !== idEvento) throw new Error('Mesa não encontrada neste evento.');
      }
      const convites = dbListar_(DB.CONVITES, c => ids.indexOf(_s_(c.ID_Convite)) !== -1);
      if (convites.some(c => c.ID_Evento !== idEvento)) throw new Error('Há convidado de outro evento na seleção.');
      const validos = convites.filter(_ocupaLugar_);
      if (!validos.length) throw new Error('Nenhum convite ativo na seleção.');

      if (mesa) {
        const jaNaMesa = validos.filter(c => c.ID_Mesa === idMesa).length;
        const ocupados = _ocupacaoMesas_(idEvento)[idMesa] || 0;
        const livres = (Number(mesa.Capacidade) || 0) - ocupados;
        const entrando = validos.length - jaNaMesa;
        if (entrando > livres) {
          throw new Error(_rotuloMesa_(mesa) + ' tem ' + Math.max(0, livres) + ' lugar(es) livre(s); você selecionou ' + entrando + '.');
        }
      }
      const mudancas = {};
      validos.forEach(c => { mudancas[c.ID_Convite] = { ID_Mesa: mesa ? idMesa : '' }; });
      dbAtualizarVarios_(DB.CONVITES, mudancas);
      return { ok: true, mensagem: mesa
        ? validos.length + ' convidado(s) em ' + _rotuloMesa_(mesa) + '.'
        : validos.length + ' convidado(s) sem mesa.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// DISTRIBUIÇÃO AUTOMÁTICA
// Coloca quem está sem mesa, mantendo grupos juntos (mesma empresa,
// mesmo gestor ou mesma categoria). Autoridades/apoiadores vão
// primeiro para as mesas VIP. Grupo que não cabe inteiro numa mesa é
// dividido pelas mesas com mais lugares livres. Não mexe em quem já
// tem mesa.
// opcoes: { agrupar: 'empresa'|'gestor'|'categoria'|'nenhum', somenteConfirmados: bool }
// ------------------------------------------------------------
function apiDistribuirMesas(token, idEvento, opcoes) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    opcoes = opcoes || {};
    return _comLock_(function() {
      const mesas = _mesasDoEvento_(idEvento);
      if (!mesas.length) throw new Error('Crie as mesas antes de distribuir.');
      const oc = _ocupacaoMesas_(idEvento);
      const idsMesas = {};
      const livres = mesas.map(m => {
        idsMesas[m.ID_Mesa] = true;
        return { id: m.ID_Mesa, vip: m.VIP === 'Sim', numero: Number(m.Numero) || 0, livre: Math.max(0, (Number(m.Capacidade) || 0) - (oc[m.ID_Mesa] || 0)) };
      });

      const pessoas = {};
      dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
      const pendentes = dbListar_(DB.CONVITES, c =>
        c.ID_Evento === idEvento && _ocupaLugar_(c) && !idsMesas[c.ID_Mesa] &&
        (!opcoes.somenteConfirmados || c.Status === 'Confirmado' || c.Status === 'Presente'));
      if (!pendentes.length) return { ok: true, mensagem: 'Não há convidados sem mesa para distribuir.' };

      const chave = {
        empresa:   c => _s_((pessoas[c.ID_Pessoa] || {}).ID_Empresa) || ('sozinho-' + c.ID_Convite),
        gestor:    c => _s_(c.Gestor) || ('sozinho-' + c.ID_Convite),
        categoria: c => _s_((pessoas[c.ID_Pessoa] || {}).Categoria) || 'Outro',
        nenhum:    () => 'todos'
      }[opcoes.agrupar] || (c => 'todos');

      const grupos = {};
      pendentes.forEach(c => {
        const vip = CATEGORIAS_VIP.indexOf(_s_((pessoas[c.ID_Pessoa] || {}).Categoria)) !== -1;
        const k = (vip ? 'V|' : 'N|') + chave(c);
        (grupos[k] = grupos[k] || []).push(c);
      });
      // VIP primeiro; depois grupos maiores (mais difíceis de encaixar).
      const ordem = Object.keys(grupos).sort((a, b) => {
        if (a[0] !== b[0]) return a[0] === 'V' ? -1 : 1;
        return grupos[b].length - grupos[a].length;
      });

      const mudancas = {};
      let semLugar = 0;
      ordem.forEach(k => {
        const vip = k[0] === 'V';
        let fila = grupos[k].slice();
        // Candidatas: para VIP, mesas VIP antes; para os demais, comuns antes.
        const candidatas = () => livres.filter(m => m.livre > 0).sort((a, b) =>
          (a.vip === vip ? 0 : 1) - (b.vip === vip ? 0 : 1) || a.numero - b.numero);
        // 1) cabe inteiro numa mesa? usa a de menor sobra (melhor encaixe)
        const inteira = candidatas().filter(m => m.livre >= fila.length && m.vip === vip)
          .sort((a, b) => a.livre - b.livre)[0] ||
          candidatas().filter(m => m.livre >= fila.length).sort((a, b) => a.livre - b.livre)[0];
        if (inteira) {
          fila.forEach(c => { mudancas[c.ID_Convite] = { ID_Mesa: inteira.id }; });
          inteira.livre -= fila.length;
          return;
        }
        // 2) divide: enche primeiro as mesas com mais lugares livres
        while (fila.length) {
          const m = candidatas().sort((a, b) => (a.vip === vip ? 0 : 1) - (b.vip === vip ? 0 : 1) || b.livre - a.livre)[0];
          if (!m) { semLugar += fila.length; break; }
          const parte = fila.splice(0, m.livre);
          parte.forEach(c => { mudancas[c.ID_Convite] = { ID_Mesa: m.id }; });
          m.livre -= parte.length;
        }
      });
      const n = dbAtualizarVarios_(DB.CONVITES, mudancas);
      return { ok: true, mensagem: n + ' convidado(s) distribuído(s).' + (semLugar ? ' ' + semLugar + ' ficaram sem mesa: faltam lugares — crie mais mesas.' : '') };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}
