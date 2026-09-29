/**
 * ============================================================
 * MESAS.GS - Mapa de mesas do evento (planta em escala real)
 * ============================================================
 * Tudo em CENTÍMETROS: o salão tem largura x profundidade reais, cada
 * mesa tem o seu tamanho real (Ø 1,50 m, 2,40 x 0,80 m...) e as
 * cadeiras ocupam 55 cm em volta do tampo. Pos_X/Pos_Y = centro da mesa.
 *
 * A configuração do salão fica na coluna Planta do evento (JSON):
 *   { v:2, w, h, corredor, margem, elementos:[{id,tipo,nome,x,y,w,h}] }
 * Eventos antigos (sem Planta) usavam uma área lógica 1000 x 640: são
 * convertidos para 20 x 12,8 m na primeira gravação (1 unidade = 2 cm).
 *
 * O convidado fica numa mesa pela coluna ID_Mesa do convite.
 * Só convites ativos ocupam lugar (Convidado, Confirmado, Presente):
 * cancelado, substituído ou recusado liberam a cadeira sozinhos.
 * ============================================================
 */

const STATUS_SENTAM = ['Convidado', 'Confirmado', 'Presente'];
// Autoridades e apoiadores vão primeiro para as mesas VIP na distribuição automática.
const CATEGORIAS_VIP = ['Deputado', 'Senador', 'Prefeito', 'Vereador', 'Secretário', 'Político', 'Patrocinador', 'Conselheiro', 'Doador'];
const FORMATOS_MESA = ['Redonda', 'Quadrada', 'Retangular'];
const PLANTA_PADRAO = { v: 2, w: 2500, h: 1800, corredor: 90, margem: 100, cadeira: 55, forma: { tipo: 'retangulo' }, elementos: [] };
const PLANTA_LEGADO = { fator: 2, w: 2000, h: 1280 };      // área lógica antiga 1000 x 640
const CADEIRA_CM = 55;                                     // cadeira + pessoa sentada, a partir da borda do tampo
const TIPOS_ELEMENTO = ['palco', 'pista', 'buffet', 'bar', 'entrada', 'banheiro', 'bloqueio'];

function _ocupaLugar_(c) { return STATUS_SENTAM.indexOf(c.Status) !== -1; }

function _rotuloMesa_(m) {
  if (!m) return '';
  const nome = _s_(m.Nome);
  return nome ? nome + ' (' + _s_(m.Numero) + ')' : 'Mesa ' + _s_(m.Numero);
}

function _formatoMesa_(f) { return FORMATOS_MESA.indexOf(_s_(f)) !== -1 ? _s_(f) : 'Redonda'; }

function _tamanhoMesaPadrao_(formato, cap) { return _geo_().tamanhoPadrao(formato, cap); }

function _tamanhoMesa_(m) {
  const formato = _formatoMesa_(m.Formato);
  const pad = _tamanhoMesaPadrao_(formato, m.Capacidade);
  const c = Number(m.Comprimento_cm) || 0, l = Number(m.Largura_cm) || 0;
  if (!c) return { c: pad.c, l: pad.l, auto: true };
  return { c: c, l: formato === 'Retangular' ? (l || pad.l) : c, auto: false };
}

// Área ocupada com as cadeiras, para enquadrar a planta e a área de espera.
function _mesaGeo_(m) {
  const t = _tamanhoMesa_(m);
  return { formato: _formatoMesa_(m.Formato), comp: t.c, larg: t.l, rot: Number(m.Rotacao) === 90 ? 90 : 0 };
}
function _pegadaMesa_(m, cadeira) { return _geo_().pegada(_mesaGeo_(m), cadeira || CADEIRA_CM); }

function _assentosMesa_(m, n, cadeira) { return _geo_().assentos(_mesaGeo_(m), n, cadeira); }

// Cores e nomes dos elementos do salão (iguais na tela e no relatório).
const ESTILO_ELEMENTO = {
  palco:    { rotulo: 'Palco',          fundo: '#E2E8F0', borda: '#475569' },
  pista:    { rotulo: 'Pista de dança', fundo: '#EDE9FE', borda: '#7C3AED' },
  buffet:   { rotulo: 'Buffet',         fundo: '#FEF3C7', borda: '#D97706' },
  bar:      { rotulo: 'Bar',            fundo: '#FCE7F3', borda: '#DB2777' },
  entrada:  { rotulo: 'Entrada',        fundo: '#DCFCE7', borda: '#16A34A' },
  banheiro: { rotulo: 'Banheiros',      fundo: '#E0F2FE', borda: '#0284C7' },
  bloqueio: { rotulo: 'Área bloqueada', fundo: '#F1F5F9', borda: '#94A3B8' }
};

function _numLimitado_(v, min, max, padrao) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

// Configuração do salão já validada. Sem Planta = padrão (ou legado convertido).
function _plantaDoEvento_(evento, temMesas) {
  let cfg = null;
  try { cfg = _s_(evento && evento.Planta) ? JSON.parse(_s_(evento.Planta)) : null; } catch (e) { cfg = null; }
  if (!cfg || cfg.v !== 2) {
    const base = temMesas ? { w: PLANTA_LEGADO.w, h: PLANTA_LEGADO.h } : {};
    return Object.assign({}, PLANTA_PADRAO, base, { elementos: [], legado: !!temMesas });
  }
  return _validarPlanta_(cfg);
}

function _validarPlanta_(cfg) {
  cfg = cfg || {};
  const w = _numLimitado_(cfg.w, 500, 30000, PLANTA_PADRAO.w), h = _numLimitado_(cfg.h, 500, 30000, PLANTA_PADRAO.h);
  const elementos = (Array.isArray(cfg.elementos) ? cfg.elementos : []).slice(0, 60).map((e, i) => ({
    id:   _s_(e.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || ('E' + (i + 1)),
    tipo: TIPOS_ELEMENTO.indexOf(_s_(e.tipo)) !== -1 ? _s_(e.tipo) : 'bloqueio',
    forma: e.forma === 'oval' ? 'oval' : 'ret',
    nome: _s_(e.nome).slice(0, 30),
    x:    _numLimitado_(e.x, 0, w, w / 2),
    y:    _numLimitado_(e.y, 0, h, h / 2),
    w:    _numLimitado_(e.w, 30, w, 300),
    h:    _numLimitado_(e.h, 30, h, 200)
  }));
  const geo = _geo_(), f = cfg.forma || {};
  const tipo = geo.FORMAS.indexOf(_s_(f.tipo)) !== -1 ? _s_(f.tipo) : 'retangulo';
  const forma = { tipo: tipo };
  if (geo.ORIENTACOES[tipo]) {
    forma.orient = geo.ORIENTACOES[tipo].indexOf(_s_(f.orient)) !== -1 ? _s_(f.orient) : geo.ORIENTACOES[tipo][0];
    forma.a = _numLimitado_(f.a, 100, 30000, Math.round(Math.min(w, h) / 3));
    forma.b = _numLimitado_(f.b, 100, 30000, Math.round(Math.min(w, h) / 3));
  }
  return {
    v: 2, w: w, h: h, forma: forma,
    corredor: _numLimitado_(cfg.corredor, 30, 500, PLANTA_PADRAO.corredor),
    margem:   _numLimitado_(cfg.margem, 0, 500, PLANTA_PADRAO.margem),
    cadeira:  _numLimitado_(cfg.cadeira, 30, 120, CADEIRA_CM),
    elementos: elementos
  };
}

// Posição em cm (converte a área lógica antiga na leitura).
function _posMesa_(m, planta) {
  const f = planta && planta.legado ? PLANTA_LEGADO.fator : 1;
  return { x: (Number(m.Pos_X) || 0) * f, y: (Number(m.Pos_Y) || 0) * f };
}

// Antes de gravar posições/salão de um evento antigo: converte tudo para cm.
// Deve rodar dentro de _comLock_.
function _migrarPlanta_(idEvento) {
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!evento) throw new Error('Evento não encontrado.');
  const mesas = _mesasDoEvento_(idEvento);
  const planta = _plantaDoEvento_(evento, mesas.length > 0);
  if (!planta.legado && _s_(evento.Planta)) return planta;
  if (planta.legado) {
    const mud = {};
    mesas.forEach(m => { const p = _posMesa_(m, planta); mud[m.ID_Mesa] = { Pos_X: Math.round(p.x), Pos_Y: Math.round(p.y) }; });
    dbAtualizarVarios_(DB.MESAS, mud);
  }
  const nova = _validarPlanta_(planta);
  dbAtualizar_(DB.EVENTOS, idEvento, { Planta: JSON.stringify(nova) });
  return nova;
}

function _mesaParaCliente_(m, ocupados, planta) {
  const t = _tamanhoMesa_(m), p = _posMesa_(m, planta);
  return {
    id:         m.ID_Mesa,
    numero:     Number(m.Numero) || 0,
    nome:       _s_(m.Nome),
    rotulo:     _rotuloMesa_(m),
    capacidade: Number(m.Capacidade) || 0,
    formato:    _formatoMesa_(m.Formato),
    vip:        m.VIP === 'Sim',
    x:          Math.round(p.x),
    y:          Math.round(p.y),
    comp:       t.c,
    larg:       t.l,
    tamanhoAuto: t.auto,
    rot:        Number(m.Rotacao) === 90 ? 90 : 0,
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
    const brutas = _mesasDoEvento_(idEvento);
    const planta = _plantaDoEvento_(evento, brutas.length > 0);
    const mesas = brutas.map(m => _mesaParaCliente_(m, oc[m.ID_Mesa], planta));
    const idsMesas = {};
    mesas.forEach(m => { idsMesas[m.id] = true; });

    const pessoas = {}, empresas = {};
    dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
    dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
    const empresaDoLote = {};
    dbListar_(DB.LOTES, l => l.ID_Evento === idEvento).forEach(l => empresaDoLote[l.ID_Lote] = l.ID_Empresa);
    const convidados = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento && _ocupaLugar_(c)).map(c => {
      const prov = _ehProvisorio_(c);
      const p = pessoas[c.ID_Pessoa] || {};
      return {
        idConvite: c.ID_Convite,
        // Vaga de grupo ainda sem nome aparece como "Convidado 3" da empresa,
        // para já poder ser distribuída nas mesas.
        nome:      prov ? _s_(c.Nome_Provisorio) : (_s_(p.Nome) || '(sem nome)'),
        provisorio: prov,
        numero:    _normNumero_(c.Numero_Convite),
        empresa:   _s_(empresas[prov ? empresaDoLote[c.ID_Lote] : p.ID_Empresa]),
        categoria: _s_(p.Categoria),
        gestor:    _s_(c.Gestor),
        status:    _s_(c.Status),
        idMesa:    idsMesas[c.ID_Mesa] ? c.ID_Mesa : ''
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const lugares = mesas.reduce((t, m) => t + m.capacidade, 0);
    const sentados = convidados.filter(c => c.idMesa).length;
    delete planta.legado;
    return { ok: true, dados: {
      evento: { id: evento.ID_Evento, nome: _s_(evento.Nome) },
      mesas: mesas,
      convidados: convidados,
      resumo: { mesas: mesas.length, lugares: lugares, sentados: sentados, semMesa: convidados.length - sentados, livres: Math.max(0, lugares - sentados) },
      podeEditar: temPermissao_(s.perfil, 'mesas', 'editar'),
      planta: planta
    } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// SALÃO (dimensões, corredor e elementos: palco, pista, buffet...)
// ------------------------------------------------------------
function apiSalvarPlanta(token, idEvento, cfg) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    return _comLock_(function() {
      _migrarPlanta_(idEvento);
      const nova = _validarPlanta_(cfg);
      dbAtualizar_(DB.EVENTOS, idEvento, { Planta: JSON.stringify(nova) });
      return { ok: true, mensagem: 'Salão salvo.', dados: nova };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// CRIAR / EDITAR / MOVER / EXCLUIR
// ------------------------------------------------------------
// Mesas novas nascem na "área de espera", à direita do salão, sem
// sobrepor nada. A tela então encaixa nas vagas livres (ou o gestor usa
// "Organizar salão").
function _posicoesEspera_(planta, existentes, novas) {
  const x0 = planta.w + 150;
  const passo = novas.reduce((mx, m) => Math.max(mx, _pegadaMesa_(m, planta.cadeira).w, _pegadaMesa_(m, planta.cadeira).h), 0) + 40;
  const colunas = Math.max(1, Math.floor(Math.max(planta.h, 600) / passo));
  const ocupadas = existentes.filter(p => p.x > planta.w);
  const pos = [];
  let k = 0;
  while (pos.length < novas.length && k < 5000) {
    const x = x0 + passo / 2 + Math.floor(k / colunas) * passo, y = passo / 2 + (k % colunas) * passo;
    k++;
    if (ocupadas.some(p => Math.abs(p.x - x) < passo * 0.9 && Math.abs(p.y - y) < passo * 0.9)) continue;
    pos.push({ x: Math.round(x), y: Math.round(y) });
  }
  return pos;
}

function _validarCapacidade_(v) {
  const n = Math.floor(Number(v));
  if (!n || n < 1 || n > 60) throw new Error('Lugares por mesa: de 1 a 60.');
  return n;
}

// Tamanho informado (cm): vazio = automático pelo nº de lugares.
function _tamanhoInformado_(formato, dados) {
  const c = Math.round(Number(dados.comprimento) || 0), l = Math.round(Number(dados.largura) || 0);
  if (!c) return { Comprimento_cm: '', Largura_cm: '' };
  if (c < 50 || c > 1200) throw new Error('Tamanho da mesa: de 0,50 m a 12 m.');
  if (formato === 'Retangular' && l && (l < 40 || l > 300)) throw new Error('Largura da mesa: de 0,40 m a 3 m.');
  return { Comprimento_cm: c, Largura_cm: formato === 'Retangular' ? (l || 80) : '' };
}

function apiCriarMesas(token, idEvento, dados) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    dados = dados || {};
    const qtd = Math.floor(Number(dados.quantidade) || 1);
    if (qtd < 1 || qtd > 200) throw new Error('Quantidade de mesas: de 1 a 200.');
    const cap = _validarCapacidade_(dados.capacidade || 8);
    const formato = _formatoMesa_(dados.formato);
    const tamanho = _tamanhoInformado_(formato, dados);
    return _comLock_(function() {
      const planta = _migrarPlanta_(idEvento);
      const existentes = _mesasDoEvento_(idEvento);
      if (existentes.length + qtd > 500) throw new Error('Limite de 500 mesas por evento.');
      let numero = existentes.reduce((mx, m) => Math.max(mx, Number(m.Numero) || 0), 0);
      const modelo = { Formato: formato, Capacidade: cap, Comprimento_cm: tamanho.Comprimento_cm, Largura_cm: tamanho.Largura_cm, Rotacao: 0 };
      const novas = [];
      for (let i = 0; i < qtd; i++) novas.push(modelo);
      const posicoes = _posicoesEspera_(planta, existentes.map(m => ({ x: Number(m.Pos_X) || 0, y: Number(m.Pos_Y) || 0 })), novas);
      const ids = [];
      for (let i = 0; i < qtd; i++) {
        numero++;
        ids.push(dbInserir_(DB.MESAS, {
          ID_Evento: idEvento, Numero: numero, Capacidade: cap,
          VIP: dados.vip ? 'Sim' : 'Não', Formato: formato,
          Nome: qtd === 1 ? _s_(dados.nome).slice(0, 40) : '',
          Pos_X: posicoes[i].x, Pos_Y: posicoes[i].y, Observacoes: '',
          Comprimento_cm: tamanho.Comprimento_cm, Largura_cm: tamanho.Largura_cm, Rotacao: 0
        }).ID_Mesa);
      }
      return { ok: true, mensagem: qtd === 1 ? 'Mesa ' + numero + ' criada.' : qtd + ' mesas criadas.', dados: { ids: ids } };
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
      const formato = _formatoMesa_(dados.formato);
      const novos = {
        Numero: numero, Capacidade: cap, Nome: _s_(dados.nome).slice(0, 40), Formato: formato,
        VIP: dados.vip ? 'Sim' : 'Não', Observacoes: _s_(dados.obs).slice(0, 200)
      };
      if (dados.comprimento !== undefined) Object.assign(novos, _tamanhoInformado_(formato, dados));
      if (dados.rotacao !== undefined) novos.Rotacao = Number(dados.rotacao) === 90 ? 90 : 0;
      dbAtualizar_(DB.MESAS, idMesa, novos);
      return { ok: true, mensagem: 'Mesa atualizada.' };
    });
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// posicoes: [{ id, x, y }] em cm — salva a planta depois de arrastar ou
// organizar (uma gravação só). Todas as mesas devem ser do mesmo evento.
function apiMoverMesas(token, posicoes) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'mesas', 'editar');
    const lista = (posicoes || []).slice(0, 500).filter(p => p && p.id);
    if (!lista.length) return { ok: true };
    return _comLock_(function() {
      const primeira = dbBuscarPorId_(DB.MESAS, _s_(lista[0].id));
      if (!primeira) throw new Error('Mesa não encontrada.');
      const idEvento = primeira.ID_Evento;
      const planta = _migrarPlanta_(idEvento);
      const doEvento = {};
      _mesasDoEvento_(idEvento).forEach(m => { doEvento[m.ID_Mesa] = true; });
      // Limite: o salão + a área de espera à direita.
      const maxX = planta.w + 20000, maxY = Math.max(planta.h, 20000);
      const mudancas = {};
      lista.forEach(p => {
        const id = _s_(p.id);
        if (!doEvento[id]) return;
        const mud = { Pos_X: _numLimitado_(p.x, 0, maxX, 0), Pos_Y: _numLimitado_(p.y, 0, maxY, 0) };
        if (p.rot !== undefined) mud.Rotacao = Number(p.rot) === 90 ? 90 : 0;
        mudancas[id] = mud;
      });
      dbAtualizarVarios_(DB.MESAS, mudancas);
      return { ok: true };
    });
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
