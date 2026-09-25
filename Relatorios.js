/**
 * ============================================================
 * RELATORIOS.GS - Relatórios em PDF (padrão executivo)
 * ============================================================
 * Cada relatório é um documento HTML A4 no padrão visual executivo
 * do Hospital da Baleia (cabeçalho com logo, seções numeradas
 * "01 • ...", tabelas com cabeçalho azul-marinho, marca d'água e
 * rodapé com código do documento). A tela mostra a prévia e o botão
 * "Gerar PDF" usa o PDF do navegador — sai idêntico à prévia, com
 * texto selecionável e numeração de páginas.
 *
 * Tipos:
 *  lista     → 01 Descrição do evento · 02 Convidados por gestor · 03 Consolidado
 *  presenca  → pós-evento: chegadas, presentes, ausentes, ocorrências
 *  mesas     → planta do salão + quem senta em cada mesa
 *  panorama  → um ou vários eventos lado a lado (comparativo)
 * ============================================================
 */

// ------------------------------------------------------------
// MARCA DOS RELATÓRIOS (configurável pelo Admin)
// Imagens ficam no Drive do dono do script (privadas) e entram no
// relatório embutidas (base64) — não dependem de link público.
// ------------------------------------------------------------
const REL_MARCA = {
  cabecalho: { chave: 'REL_LOGO_CAB', rotulo: 'Logo do cabeçalho' },
  marca:     { chave: 'REL_MARCA',    rotulo: "Marca d'água" },
  rodape:    { chave: 'REL_LOGO_ROD', rotulo: 'Logo do rodapé' }
};
const REL_OPACIDADE_PADRAO = 0.035;
const REL_RODAPE_PADRAO = 'Hospital da Baleia · Movimento pela Vida';

function _imagemDrive_(idArquivo) {
  const chave = 'img_' + idArquivo;
  const emCache = _cacheLer_(chave);
  if (emCache && emCache.uri) return emCache.uri;
  const blob = DriveApp.getFileById(idArquivo).getBlob();
  const uri = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  _cacheGravar_(chave, { uri: uri });
  return uri;
}

// Imagem configurada (ou a padrão; '' = nenhuma).
function _imagemRelatorio_(tipo) {
  const id = _s_(_configObter_(REL_MARCA[tipo].chave, ''));
  if (id) { try { return _imagemDrive_(id); } catch (e) { /* arquivo apagado: usa o padrão */ } }
  if (tipo === 'cabecalho') return 'data:image/png;base64,' + MARCA_LOGO_PADRAO;
  if (tipo === 'marca') return 'data:image/png;base64,' + MARCA_BALEIA_PADRAO;
  return '';
}

function _ajustesRelatorio_() {
  const op = Number(_configObter_('REL_MARCA_OPACIDADE', REL_OPACIDADE_PADRAO));
  return {
    opacidade: isNaN(op) ? REL_OPACIDADE_PADRAO : Math.min(0.15, Math.max(0, op)),
    rodapeTexto: _s_(_configObter_('REL_RODAPE_TEXTO', REL_RODAPE_PADRAO)) || REL_RODAPE_PADRAO
  };
}

function apiMarcaRelatorio(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito ao administrador.' };
  const dados = _ajustesRelatorio_();
  Object.keys(REL_MARCA).forEach(t => {
    dados[t] = _imagemRelatorio_(t);
    dados[t + 'Personalizado'] = !!_configObter_(REL_MARCA[t].chave, '');
  });
  return { ok: true, dados: dados };
}

function apiSalvarMarcaRelatorio(token, tipo, dataUri, nomeArquivo) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera a marca dos relatórios.' };
    const cfg = REL_MARCA[tipo];
    if (!cfg) throw new Error('Tipo de imagem inválido.');
    const m = String(dataUri || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new Error('Envie uma imagem PNG, JPG ou WEBP.');
    const bytes = Utilities.base64Decode(m[3]);
    if (bytes.length > 3 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 3 MB).');
    const arquivo = DriveApp.createFile(Utilities.newBlob(bytes, m[1], 'relatorio-' + tipo + '-' + (nomeArquivo || 'imagem')));
    const antigo = _s_(_configObter_(cfg.chave, ''));
    _configSalvar_(cfg.chave, arquivo.getId());
    if (antigo) { try { DriveApp.getFileById(antigo).setTrashed(true); } catch (e) {} }
    return { ok: true, mensagem: cfg.rotulo + ' atualizada.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiRemoverMarcaRelatorio(token, tipo) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera a marca dos relatórios.' };
    const cfg = REL_MARCA[tipo];
    if (!cfg) throw new Error('Tipo de imagem inválido.');
    const antigo = _s_(_configObter_(cfg.chave, ''));
    if (antigo) {
      dbExcluir_(DB.CONFIG, cfg.chave);
      try { DriveApp.getFileById(antigo).setTrashed(true); } catch (e) {}
    }
    return { ok: true, mensagem: tipo === 'rodape' ? 'Logo do rodapé removida.' : cfg.rotulo + ': voltou para a padrão.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiSalvarAjustesRelatorio(token, ajustes) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera a marca dos relatórios.' };
    ajustes = ajustes || {};
    if (ajustes.opacidade !== undefined) {
      const op = Number(ajustes.opacidade);
      if (isNaN(op) || op < 0 || op > 0.15) throw new Error('Intensidade da marca d\'água inválida.');
      _configSalvar_('REL_MARCA_OPACIDADE', op);
    }
    if (ajustes.rodapeTexto !== undefined) _configSalvar_('REL_RODAPE_TEXTO', _s_(ajustes.rodapeTexto).slice(0, 90) || REL_RODAPE_PADRAO);
    return { ok: true, mensagem: 'Ajustes dos relatórios salvos.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// ------------------------------------------------------------
// PEÇAS DO DOCUMENTO
// ------------------------------------------------------------
function _h_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _pct_(a, b) { return b ? Math.round(1000 * a / b) / 10 : 0; }
function _fmtPct_(n) { return String(n).replace('.', ',') + '%'; }

const REL_COR_STATUS = {
  'Presente': '#16A34A', 'Confirmado': '#1E3A8A', 'Convidado': '#64748B',
  'Recusado': '#F97316', 'Cancelado': '#EF4444', 'Substituído': '#94A3B8'
};

const REL_ONDA = '<div class="onda"><svg preserveAspectRatio="none" viewBox="0 0 1000 8" xmlns="http://www.w3.org/2000/svg"><path d="M0,4 Q12.5,0 25,4' +
  (function() { let p = ''; for (let x = 50; x <= 1000; x += 25) p += ' T' + x + ',4'; return p; })() +
  '" stroke="#94A3B8" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></div>';

const REL_CSS = [
  '@page { size: A4; margin: 13mm 12mm 15mm 12mm;',
  '  @bottom-right { content: "Pág. " counter(page) " / " counter(pages); font: 7.5pt Arial, Helvetica, sans-serif; color: #64748B; }',
  '  @bottom-left { content: element(rodapeFixo); } }',
  '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  'html, body { margin: 0; padding: 0; }',
  'body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; background: #E9EEF4; font-size: 9pt; line-height: 1.45; }',
  '.folha { position: relative; background: #fff; width: 210mm; min-height: 297mm; margin: 18px auto; padding: 14mm 13mm 12mm; box-shadow: 0 4px 24px rgba(15,23,42,.12); }',
  '@media print { body { background: #fff; } .folha { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; } }',
  '@media screen and (max-width: 820px) { .folha { width: auto; min-height: 0; margin: 0; padding: 18px 14px; box-shadow: none; } }',
  /* Marca d'água: fixa no centro de CADA página impressa (e da folha na tela) */
  /* na frente do conteúdo, mas quase transparente e em "multiplicar": tinge sem cobrir o texto */
  '.marca-dagua { position: fixed; top: 50%; left: 50%; width: 150mm; max-width: 80vw; transform: translate(-50%, -50%); pointer-events: none; z-index: 5; mix-blend-mode: multiply; }',
  '.marca-dagua img { width: 100%; display: block; }',
  '.conteudo { position: relative; z-index: 1; }',
  /* cabeçalho */
  '.cab { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-bottom: 10px; }',
  '.cab-esq { display: flex; align-items: center; min-width: 0; }',
  '.cab-logo { flex: none; width: 44mm; height: 19mm; display: flex; align-items: center; }',
  '.cab-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }',
  '.cab-div { width: 1px; align-self: stretch; background: #E2E8F0; margin: 0 7mm 0 5mm; flex: none; }',
  '.kicker { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .12em; color: #64748B; font-weight: 700; }',
  '.titulo { font-size: 15pt; font-weight: 700; letter-spacing: -.01em; margin: 1px 0 1px; line-height: 1.2; }',
  '.subtitulo { font-size: 8.5pt; color: #64748B; }',
  '.cab-meta { font-size: 7.5pt; color: #64748B; margin-top: 4px; letter-spacing: .02em; }',
  '.cab-meta b { color: #94A3B8; font-weight: 700; } .cab-meta span { color: #475569; font-weight: 700; }',
  '.cab-dir { text-align: right; flex: none; }',
  '.status-doc { font-size: 7.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; }',
  '.status-doc i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }',
  '.cab-dir .rot { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .1em; color: #64748B; font-weight: 700; margin-top: 7px; }',
  '.cab-dir .val { font-size: 9.5pt; font-weight: 700; }',
  /* seções */
  '.secao { margin-top: 20px; }',
  '.secao-tit { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; break-after: avoid; }',
  '.secao-tit h2 { font-size: 7.8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .2em; margin: 0; }',
  '.secao-tit .dir { font-size: 7.5pt; color: #64748B; }',
  '.onda { height: 8px; margin: 6px 0 14px; } .onda svg { width: 100%; height: 8px; display: block; }',
  '.grade2 { display: flex; gap: 18px; } .grade2 > div { flex: 1; min-width: 0; }',
  '.col-borda { border-left: 1px solid #E2E8F0; padding-left: 16px; }',
  '.texto { font-size: 8.8pt; color: #334155; text-align: justify; margin: 0 0 6px; }',
  '.def { width: 100%; border-collapse: collapse; font-size: 8.2pt; }',
  '.def td { padding: 4px 0; border-bottom: 1px solid #F1F5F9; vertical-align: top; }',
  '.def td:first-child { color: #64748B; text-transform: uppercase; font-size: 6.8pt; letter-spacing: .08em; font-weight: 700; width: 38%; padding-top: 5px; }',
  '.def td:last-child { font-weight: 700; text-align: right; }',
  /* indicadores */
  '.kpis { display: flex; margin-top: 14px; border-top: 1px solid #E2E8F0; border-bottom: 1px solid #E2E8F0; break-inside: avoid; }',
  '.kpi { flex: 1; text-align: center; padding: 10px 6px 9px; }',
  '.kpi + .kpi { border-left: 1px solid #E2E8F0; }',
  '.kpi .r { font-size: 6.5pt; text-transform: uppercase; letter-spacing: .1em; color: #64748B; font-weight: 700; }',
  '.kpi .v { font-size: 18pt; font-weight: 300; line-height: 1.15; margin-top: 2px; }',
  '.kpi .s { font-size: 6.8pt; color: #94A3B8; margin-top: 2px; }',
  /* tabelas */
  'table.tab { width: 100%; border-collapse: collapse; font-size: 8pt; }',
  'table.tab thead { display: table-header-group; }',
  'table.tab th { background: rgba(27,42,107,.9); color: #fff; text-transform: uppercase; letter-spacing: .08em; font-size: 6.6pt; font-weight: 700; text-align: left; padding: 6px 7px; }',
  'table.tab td { padding: 5px 7px; border-bottom: 1px solid rgba(27,42,107,.09); vertical-align: top; }',
  'table.tab tr { break-inside: avoid; }',
  'table.tab .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }',
  'table.tab .c { text-align: center; }',
  'table.tab .num { color: #94A3B8; width: 22px; }',
  'table.tab .sub { display: block; font-size: 7pt; color: #64748B; }',
  'table.tab .st { font-weight: 700; font-size: 7.4pt; white-space: nowrap; }',
  'table.tab tfoot td { font-weight: 700; border-top: 1.5px solid rgba(27,42,107,.35); border-bottom: none; }',
  '.grupo { margin-top: 14px; break-inside: auto; }',
  '.grupo-tit { display: flex; justify-content: space-between; align-items: baseline; border-left: 3px solid #1B2A6B; background: #F4F6FB; padding: 6px 9px; margin-bottom: 0; break-after: avoid; }',
  '.grupo-tit .g { font-size: 6.6pt; text-transform: uppercase; letter-spacing: .12em; color: #64748B; font-weight: 700; }',
  '.grupo-tit .nome { font-size: 9.5pt; font-weight: 700; margin-left: 6px; }',
  '.grupo-tit .cont { font-size: 7.5pt; color: #475569; }',
  /* barras */
  '.barra-lin { margin-bottom: 7px; break-inside: avoid; }',
  '.barra-lin .t { display: flex; justify-content: space-between; font-size: 8pt; }',
  '.barra-lin .t b { font-variant-numeric: tabular-nums; } .barra-lin .t small { color: #94A3B8; font-weight: 400; }',
  '.trilho { height: 4px; background: #F1F5F9; margin-top: 3px; } .trilho > div { height: 100%; }',
  '.mini-barra { display: inline-block; width: 46px; height: 4px; background: #F1F5F9; vertical-align: middle; margin-right: 6px; } .mini-barra > div { height: 100%; }',
  '.vazio { font-size: 8.5pt; color: #94A3B8; padding: 10px 0; }',
  /* mesas */
  '.planta { border: 1px solid #E2E8F0; background: #FBFCFE; break-inside: avoid; } .planta svg { display: block; width: 100%; height: auto; }',
  '.mesas-grade { display: flex; flex-wrap: wrap; gap: 10px; }',
  '.mesa-bloco { width: calc(50% - 5px); border: 1px solid #E2E8F0; break-inside: avoid; }',
  '.mesa-bloco .mt { display: flex; justify-content: space-between; background: #F4F6FB; border-left: 3px solid #1B2A6B; padding: 5px 8px; font-weight: 700; font-size: 8.6pt; }',
  '.mesa-bloco.vip .mt { border-left-color: #F59E0B; background: #FFFBEB; }',
  '.mesa-bloco ol { margin: 0; padding: 5px 8px 6px 26px; font-size: 7.8pt; } .mesa-bloco li { padding: 1px 0; } .mesa-bloco li small { color: #64748B; }',
  /* rodapé */
  '.rodape { margin-top: 26px; border-top: 1px solid #E2E8F0; padding-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 7.3pt; color: #64748B; break-inside: avoid; }',
  '.rodape .esq { display: flex; align-items: center; gap: 8px; } .rodape .esq img { height: 8mm; max-width: 32mm; object-fit: contain; }',
  '.rodape strong { color: #0F172A; }',
  '.assinatura { margin-top: 4px; font-size: 7pt; color: #94A3B8; }'
].join('\n');

function _secao_(num, titulo, direita, corpo) {
  return '<section class="secao"><div class="secao-tit"><h2>' + num + ' • ' + _h_(titulo) + '</h2>' +
    (direita ? '<span class="dir">' + _h_(direita) + '</span>' : '') + '</div>' + REL_ONDA + corpo + '</section>';
}

function _kpis_(lista) {
  return '<div class="kpis">' + lista.map(k =>
    '<div class="kpi"><div class="r"' + (k.cor ? ' style="color:' + k.cor + '"' : '') + '>' + _h_(k.r) + '</div>' +
    '<div class="v"' + (k.cor ? ' style="color:' + k.cor + ';font-weight:600"' : '') + '>' + _h_(k.v) + '</div>' +
    (k.s ? '<div class="s">' + _h_(k.s) + '</div>' : '') + '</div>').join('') + '</div>';
}

function _tabela_(cabecalhos, linhas, rodape) {
  return '<table class="tab"><thead><tr>' + cabecalhos.map(c =>
    '<th' + (c.cls ? ' class="' + c.cls + '"' : '') + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + _h_(c.t) + '</th>').join('') +
    '</tr></thead><tbody>' + linhas.join('') + '</tbody>' + (rodape ? '<tfoot>' + rodape + '</tfoot>' : '') + '</table>';
}

function _barra_(rotulo, n, total, cor) {
  const p = _pct_(n, total);
  return '<div class="barra-lin"><div class="t"><span>' + _h_(rotulo) + '</span><b>' + n + ' <small>(' + _fmtPct_(p) + ')</small></b></div>' +
    '<div class="trilho"><div style="width:' + Math.min(100, p) + '%;background:' + (cor || '#1E3A8A') + '"></div></div></div>';
}

function _miniBarra_(p, cor) {
  return '<span class="mini-barra"><div style="width:' + Math.min(100, p) + '%;background:' + (cor || '#16A34A') + '"></div></span>';
}

function _stTxt_(status) {
  return '<span class="st" style="color:' + (REL_COR_STATUS[status] || '#64748B') + '">' + _h_(status) + '</span>';
}

function _def_(pares) {
  return '<table class="def">' + pares.filter(p => p).map(p => '<tr><td>' + _h_(p[0]) + '</td><td>' + _h_(p[1]) + '</td></tr>').join('') + '</table>';
}

// Documento completo. cfg: { kicker, titulo, subtitulo, meta, status:{texto,cor}, direita:[{r,v}], codigo, secoes, sessao }
function _documento_(cfg) {
  const aj = _ajustesRelatorio_();
  const logo = _imagemRelatorio_('cabecalho');
  const marca = _imagemRelatorio_('marca');
  const logoRod = _imagemRelatorio_('rodape');
  const agora = new Date();
  const emitido = _fmtData_(agora, 'dd.MM.yyyy HH:mm');
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + _h_(cfg.arquivo || cfg.titulo) + '</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><style>' + REL_CSS + '</style></head><body>' +
    (marca && aj.opacidade > 0 ? '<div class="marca-dagua" aria-hidden="true"><img src="' + marca + '" alt="" style="opacity:' + aj.opacidade + '"></div>' : '') +
    '<main class="folha"><div class="conteudo">' +
    '<header class="cab"><div class="cab-esq">' +
      (logo ? '<div class="cab-logo"><img src="' + logo + '" alt="Hospital da Baleia"></div><div class="cab-div"></div>' : '') +
      '<div style="min-width:0"><div class="kicker">' + _h_(cfg.kicker) + '</div>' +
      '<div class="titulo">' + _h_(cfg.titulo) + '</div>' +
      (cfg.subtitulo ? '<div class="subtitulo">' + _h_(cfg.subtitulo) + '</div>' : '') +
      '<div class="cab-meta"><b>EMITIDO EM:</b> <span>' + emitido + '</span>' + (cfg.meta ? ' &nbsp;·&nbsp; ' + cfg.meta : '') + '</div></div>' +
    '</div><div class="cab-dir">' +
      (cfg.status ? '<div class="status-doc" style="color:' + cfg.status.cor + '"><i style="background:' + cfg.status.cor + '"></i>' + _h_(cfg.status.texto) + '</div>' : '') +
      (cfg.direita || []).map(d => '<div class="rot">' + _h_(d.r) + '</div><div class="val">' + _h_(d.v) + '</div>').join('') +
    '</div></header>' +
    cfg.secoes.join('') +
    '<footer class="rodape"><div class="esq">' + (logoRod ? '<img src="' + logoRod + '" alt="">' : '') +
      '<span>' + _h_(aj.rodapeTexto).replace(/ · | \/ /, ' <span style="color:#CBD5E1">/</span> ') + '</span></div>' +
      '<div>Documento de uso interno' + (cfg.sessao ? ' · emitido por ' + _h_(cfg.sessao.gestor) : '') + '</div>' +
      '<div>DOC: <strong>' + _h_(cfg.codigo) + '</strong></div></footer>' +
    '</div></main></body></html>';
}

function _codigoDoc_(prefixo, id) {
  return prefixo + '-' + _s_(id).replace(/[^A-Za-z0-9]/g, '') + '-' + _fmtData_(new Date(), 'ddMMyy');
}

function _statusEvento_(evento) {
  const st = _s_(evento.Status) || 'Planejamento';
  const cor = { 'Ativo': '#16A34A', 'Planejamento': '#F97316', 'Encerrado': '#64748B' }[st] || '#64748B';
  return { texto: 'Status: ' + st, cor: cor };
}

// Carrega tudo de um evento uma vez só (as abas vêm do cache).
function _contextoEvento_(idEvento) {
  const evento = dbBuscarPorId_(DB.EVENTOS, idEvento);
  if (!evento) throw new Error('Evento não encontrado.');
  const pessoas = {}, empresas = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e);
  const mesas = _rotulosMesas_(idEvento);
  const convites = dbListar_(DB.CONVITES, c => c.ID_Evento === idEvento).map(c => {
    const p = pessoas[c.ID_Pessoa] || {};
    return {
      c: c, p: p,
      nome: _s_(p.Nome) || '(sem nome)', cargo: _s_(p.Cargo), categoria: _s_(p.Categoria) || 'Outro',
      empresa: _s_((empresas[p.ID_Empresa] || {}).Nome), documento: _s_(p.Documento),
      contato: [_s_(p.Telefone), _s_(p.Email)].filter(Boolean).join(' · '),
      gestor: _s_(c.Gestor), status: _s_(c.Status), origem: _s_(c.Origem),
      mesa: _ocupaLugar_(c) ? _s_(mesas[c.ID_Mesa]) : ''
    };
  });
  return { evento: evento, convites: convites, pessoas: pessoas, empresas: empresas };
}

function _descricaoEvento_(ctx, extra) {
  const e = ctx.evento;
  const ativos = ctx.convites.filter(x => _conviteAtivo_(x.c));
  const gestores = {};
  ativos.forEach(x => { if (x.gestor) gestores[x.gestor] = true; });
  const cap = Number(e.Capacidade) || 0;
  const desc = _s_(e.Descricao) || _s_(e.Observacoes);
  return '<div class="grade2"><div>' +
      '<p class="texto">' + (desc ? _h_(desc) : '<span style="color:#94A3B8">Sem descrição cadastrada para este evento.</span>') + '</p>' +
      (extra || '') +
    '</div><div class="col-borda" style="flex:0 0 42%">' + _def_([
      ['Evento', _s_(e.Nome)],
      ['Data', _fmtData_(e.Data) || 'A definir'],
      ['Local', _s_(e.Local) || '—'],
      ['Status', _s_(e.Status) || 'Planejamento'],
      ['Capacidade', cap ? cap + ' pessoas' : 'Sem limite'],
      ['Gestores envolvidos', String(Object.keys(gestores).length)]
    ]) + '</div></div>';
}

// ------------------------------------------------------------
// 1) LISTA DE CONVIDADOS (por gestor)
// opcoes: { incluirInativos, documento, contato, gestor, somente: 'todos'|'confirmados'|'presentes' }
// ------------------------------------------------------------
function _relLista_(idEvento, op, sessao) {
  const ctx = _contextoEvento_(idEvento);
  const e = ctx.evento;
  const ativos = ctx.convites.filter(x => _conviteAtivo_(x.c));
  const cont = st => ativos.filter(x => x.status === st).length;
  const cap = Number(e.Capacidade) || 0;
  const presentes = cont('Presente'), confirmados = cont('Confirmado') + presentes;

  let lista = op.incluirInativos ? ctx.convites.slice() : ativos.slice();
  if (op.somente === 'confirmados') lista = lista.filter(x => x.status === 'Confirmado' || x.status === 'Presente');
  if (op.somente === 'presentes') lista = lista.filter(x => x.status === 'Presente');
  if (op.gestor) lista = lista.filter(x => x.gestor === op.gestor);

  const porGestor = {};
  lista.forEach(x => { const g = x.gestor || ''; (porGestor[g] = porGestor[g] || []).push(x); });
  const nomesGestores = Object.keys(porGestor).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, 'pt-BR'));

  const cols = [{ t: 'Nº', cls: 'num' }, { t: 'Convidado' }, { t: 'Empresa' }, { t: 'Categoria' }];
  if (op.documento) cols.push({ t: 'Documento' });
  if (op.contato) cols.push({ t: 'Contato' });
  cols.push({ t: 'Mesa' }, { t: 'Status', cls: 'n' });

  const grupos = nomesGestores.map(g => {
    const itens = porGestor[g].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const conf = itens.filter(x => x.status === 'Confirmado' || x.status === 'Presente').length;
    const linhas = itens.map((x, i) => '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td><b>' + _h_(x.nome) + '</b>' + (x.cargo ? '<span class="sub">' + _h_(x.cargo) + '</span>' : '') + '</td>' +
      '<td>' + (_h_(x.empresa) || '<span style="color:#CBD5E1">—</span>') + '</td>' +
      '<td>' + _h_(x.categoria) + '</td>' +
      (op.documento ? '<td style="white-space:nowrap">' + (_h_(x.documento) || '—') + '</td>' : '') +
      (op.contato ? '<td>' + (_h_(x.contato) || '—') + '</td>' : '') +
      '<td>' + (_h_(x.mesa) || '<span style="color:#CBD5E1">—</span>') + '</td>' +
      '<td class="n">' + _stTxt_(x.status) + '</td></tr>');
    return '<div class="grupo"><div class="grupo-tit"><div><span class="g">Gestor</span><span class="nome">' + _h_(g || 'Sem gestor (walk-in e outros)') + '</span></div>' +
      '<div class="cont">' + itens.length + ' convidado(s) · ' + conf + ' confirmado(s)</div></div>' + _tabela_(cols, linhas) + '</div>';
  });

  // Consolidado por gestor (sempre sobre a lista ativa inteira)
  const cons = {};
  ativos.forEach(x => {
    const g = x.gestor || 'Sem gestor';
    const r = cons[g] = cons[g] || { t: 0, c: 0, p: 0, a: 0 };
    r.t++; if (x.status === 'Confirmado' || x.status === 'Presente') r.c++; if (x.status === 'Presente') r.p++; if (x.status === 'Convidado') r.a++;
  });
  const recusados = ctx.convites.filter(x => x.status === 'Recusado').length;
  const linhasCons = Object.keys(cons).sort((a, b) => cons[b].t - cons[a].t).map(g => {
    const r = cons[g], taxa = _pct_(r.c, r.t);
    return '<tr><td><b>' + _h_(g) + '</b></td><td class="n">' + r.t + '</td><td class="n">' + r.c + '</td><td class="n">' + r.a + '</td><td class="n">' + r.p + '</td>' +
      '<td class="n">' + _miniBarra_(taxa, '#1E3A8A') + _fmtPct_(taxa) + '</td></tr>';
  });
  const tot = Object.keys(cons).reduce((a, g) => ({ t: a.t + cons[g].t, c: a.c + cons[g].c, a: a.a + cons[g].a, p: a.p + cons[g].p }), { t: 0, c: 0, a: 0, p: 0 });

  const filtros = [];
  if (op.somente === 'confirmados') filtros.push('somente confirmados');
  if (op.somente === 'presentes') filtros.push('somente presentes');
  if (op.gestor) filtros.push('gestor: ' + op.gestor);
  if (op.incluirInativos) filtros.push('inclui cancelados e substituídos');

  return _documento_({
    kicker: 'Relatório de Convidados', titulo: _s_(e.Nome),
    subtitulo: [_s_(e.Local), 'Lista organizada por gestor responsável'].filter(Boolean).join(' • '),
    status: _statusEvento_(e),
    direita: [{ r: 'Data do evento', v: _fmtData_(e.Data) || 'A definir' }],
    codigo: _codigoDoc_('LST', e.ID_Evento), sessao: sessao, arquivo: 'Lista de convidados - ' + _s_(e.Nome),
    secoes: [
      _secao_('01', 'Descrição do evento', '', _descricaoEvento_(ctx) + _kpis_([
        { r: 'Na lista', v: ativos.length, s: 'convites ativos' },
        { r: 'Confirmados', v: confirmados, s: _fmtPct_(_pct_(confirmados, ativos.length)) + ' da lista', cor: '#1E3A8A' },
        { r: 'Presentes', v: presentes, s: presentes ? _fmtPct_(_pct_(presentes, ativos.length)) + ' da lista' : 'check-in não iniciado', cor: '#16A34A' },
        { r: 'Recusaram', v: recusados, s: 'avisaram que não vão', cor: recusados ? '#F97316' : '' },
        { r: 'Ocupação', v: cap ? _fmtPct_(_pct_(ativos.length, cap)) : '—', s: cap ? ativos.length + ' de ' + cap + ' vagas' : 'sem limite de capacidade' }
      ])),
      _secao_('02', 'Convidados por gestor', lista.length + ' convidado(s)' + (filtros.length ? ' · ' + filtros.join(' · ') : ''),
        grupos.length ? grupos.join('') : '<div class="vazio">Nenhum convidado para os filtros escolhidos.</div>'),
      _secao_('03', 'Consolidado por gestor', 'Base: lista ativa completa',
        linhasCons.length ? _tabela_([{ t: 'Gestor' }, { t: 'Convidados', cls: 'n' }, { t: 'Confirmados', cls: 'n' }, { t: 'Sem resposta', cls: 'n' }, { t: 'Presentes', cls: 'n' }, { t: 'Taxa de confirmação', cls: 'n' }],
          linhasCons, '<tr><td>Total</td><td class="n">' + tot.t + '</td><td class="n">' + tot.c + '</td><td class="n">' + tot.a + '</td><td class="n">' + tot.p + '</td><td class="n">' + _fmtPct_(_pct_(tot.c, tot.t)) + '</td></tr>')
        : '<div class="vazio">Sem convidados ativos.</div>')
    ]
  });
}

// ------------------------------------------------------------
// 2) PRESENÇA E CHECK-IN (pós-evento)
// ------------------------------------------------------------
function _relPresenca_(idEvento, op, sessao) {
  const ctx = _contextoEvento_(idEvento);
  const e = ctx.evento;
  const ativos = ctx.convites.filter(x => _conviteAtivo_(x.c));
  const presentes = ativos.filter(x => x.status === 'Presente')
    .sort((a, b) => new Date(a.c.Checkin_DataHora || 0) - new Date(b.c.Checkin_DataHora || 0));
  const esperados = ativos.filter(x => x.status !== 'Recusado').length;
  const walkins = ctx.convites.filter(x => x.origem === 'Walk-in');
  const substituicoes = ctx.convites.filter(x => x.origem === 'Substituição');
  const cancelados = ctx.convites.filter(x => x.status === 'Cancelado');
  const ausConf = ativos.filter(x => x.status === 'Confirmado');
  const ausSemResp = ativos.filter(x => x.status === 'Convidado');
  const taxa = _pct_(presentes.length, esperados);

  const porHora = {};
  presentes.forEach(x => { const h = _fmtData_(x.c.Checkin_DataHora, 'HH') ; if (h) porHora[h] = (porHora[h] || 0) + 1; });
  const horas = Object.keys(porHora).sort();
  const maxHora = Math.max.apply(null, horas.map(h => porHora[h]).concat([1]));
  const fluxo = horas.length ? horas.map(h => _barra_(h + 'h – ' + h + 'h59', porHora[h], presentes.length, '#16A34A')).join('')
    : '<div class="vazio">Nenhum check-in registrado.</div>';
  const picoH = horas.filter(h => porHora[h] === maxHora)[0];

  const nomeOriginal = {};
  ctx.convites.forEach(x => { nomeOriginal[x.c.ID_Convite] = x.nome; });

  const tabPresentes = presentes.length ? _tabela_(
    [{ t: 'Hora', cls: 'num', w: '42px' }, { t: 'Convidado' }, { t: 'Empresa' }, { t: 'Gestor' }, { t: 'Mesa' }, { t: 'Origem' }, { t: 'Registrado por' }],
    presentes.map(x => '<tr><td class="num" style="color:#0F172A">' + _h_(_fmtData_(x.c.Checkin_DataHora, 'HH:mm')) + '</td><td><b>' + _h_(x.nome) + '</b>' + (x.cargo ? '<span class="sub">' + _h_(x.cargo) + '</span>' : '') + '</td>' +
      '<td>' + (_h_(x.empresa) || '—') + '</td><td>' + (_h_(x.gestor) || '—') + '</td><td>' + (_h_(x.mesa) || '—') + '</td><td>' + _h_(x.origem) + '</td>' +
      '<td><span class="sub" style="font-size:7.3pt">' + _h_(_s_(x.c.Checkin_Por).split(' · ')[0]) + '</span></td></tr>')) : '<div class="vazio">Ninguém fez check-in neste evento ainda.</div>';

  const ausentes = ausConf.concat(ausSemResp);
  const tabAusentes = ausentes.length ? _tabela_(
    [{ t: 'Nº', cls: 'num' }, { t: 'Convidado' }, { t: 'Empresa' }, { t: 'Gestor' }, { t: 'Situação', cls: 'n' }],
    ausentes.map((x, i) => '<tr><td class="num">' + (i + 1) + '</td><td><b>' + _h_(x.nome) + '</b></td><td>' + (_h_(x.empresa) || '—') + '</td><td>' + (_h_(x.gestor) || '—') + '</td>' +
      '<td class="n"><span class="st" style="color:' + (x.status === 'Confirmado' ? '#EF4444' : '#64748B') + '">' + (x.status === 'Confirmado' ? 'Confirmou e não veio' : 'Não respondeu') + '</span></td></tr>')) : '<div class="vazio">Nenhuma ausência entre os convidados esperados.</div>';

  const ocorrencias = [];
  walkins.forEach(x => ocorrencias.push('<tr><td><span class="st" style="color:#F97316">Walk-in</span></td><td><b>' + _h_(x.nome) + '</b></td><td>Entrada sem convite' + (x.c.Autorizado_Por ? ', autorizada por ' + _h_(x.c.Autorizado_Por) : '') + '</td><td class="n">' + _h_(_fmtData_(x.c.Checkin_DataHora, 'HH:mm')) + '</td></tr>'));
  substituicoes.forEach(x => ocorrencias.push('<tr><td><span class="st" style="color:#1E3A8A">Substituição</span></td><td><b>' + _h_(x.nome) + '</b><span class="sub">no lugar de ' + _h_(nomeOriginal[x.c.ID_Convite_Original] || '—') + '</span></td><td>' + (_h_(x.c.Motivo_Substituicao) || 'Sem motivo informado') + (x.c.Autorizado_Por ? ' · autorizado por ' + _h_(x.c.Autorizado_Por) : '') + '</td><td class="n">' + _h_(_fmtData_(x.c.Checkin_DataHora, 'HH:mm')) + '</td></tr>'));
  cancelados.forEach(x => ocorrencias.push('<tr><td><span class="st" style="color:#EF4444">Cancelamento</span></td><td><b>' + _h_(x.nome) + '</b></td><td>' + _h_(_s_(x.c.Observacoes).split(' | ').pop() || 'Convite cancelado') + '</td><td class="n">—</td></tr>'));

  return _documento_({
    kicker: 'Relatório de Presença e Check-in', titulo: _s_(e.Nome),
    subtitulo: [_s_(e.Local), 'Controle de entrada e ocorrências'].filter(Boolean).join(' • '),
    status: _statusEvento_(e),
    direita: [{ r: 'Data do evento', v: _fmtData_(e.Data) || 'A definir' }, { r: 'Taxa de presença', v: _fmtPct_(taxa) }],
    codigo: _codigoDoc_('PRS', e.ID_Evento), sessao: sessao, arquivo: 'Presença - ' + _s_(e.Nome),
    secoes: [
      _secao_('01', 'Descrição do evento', '', _descricaoEvento_(ctx) + _kpis_([
        { r: 'Esperados', v: esperados, s: 'lista ativa, sem recusas' },
        { r: 'Presentes', v: presentes.length, s: _fmtPct_(taxa) + ' de presença', cor: '#16A34A' },
        { r: 'Confirmaram e faltaram', v: ausConf.length, s: 'no-show', cor: ausConf.length ? '#EF4444' : '' },
        { r: 'Walk-ins', v: walkins.length, s: 'entradas sem convite', cor: walkins.length ? '#F97316' : '' },
        { r: 'Substituições', v: substituicoes.length, s: 'trocas na porta' }
      ])),
      _secao_('02', 'Fluxo de entrada', picoH ? 'Pico às ' + picoH + 'h (' + maxHora + ' entradas)' : '', fluxo),
      _secao_('03', 'Presentes (ordem de chegada)', presentes.length + ' pessoa(s)', tabPresentes),
      _secao_('04', 'Ausências', ausConf.length + ' confirmaram e faltaram · ' + ausSemResp.length + ' sem resposta', tabAusentes),
      _secao_('05', 'Ocorrências', ocorrencias.length + ' registro(s)',
        ocorrencias.length ? _tabela_([{ t: 'Tipo', w: '90px' }, { t: 'Pessoa' }, { t: 'Detalhe' }, { t: 'Hora', cls: 'n' }], ocorrencias) : '<div class="vazio">Sem ocorrências.</div>')
    ]
  });
}

// ------------------------------------------------------------
// 3) MAPA DE MESAS
// ------------------------------------------------------------
function _svgPlanta_(mesas, oc) {
  // Enquadra só a área ocupada pelas mesas (sem sobra de salão vazio).
  const xs = mesas.map(m => Number(m.Pos_X) || 0), ys = mesas.map(m => Number(m.Pos_Y) || 0);
  const margem = 95;
  let x0 = Math.max(0, Math.min.apply(null, xs) - margem), x1 = Math.min(PLANTA.LARGURA, Math.max.apply(null, xs) + margem);
  let y0 = Math.max(0, Math.min.apply(null, ys) - margem), y1 = Math.min(PLANTA.ALTURA, Math.max.apply(null, ys) + margem);
  if (x1 - x0 < 500) { const c = (x0 + x1) / 2; x0 = Math.max(0, c - 250); x1 = x0 + 500; }
  if (y1 - y0 < 220) { const c = (y0 + y1) / 2; y0 = Math.max(0, c - 110); y1 = y0 + 220; }
  const partes = ['<svg viewBox="' + x0 + ' ' + y0 + ' ' + (x1 - x0) + ' ' + (y1 - y0) + '" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">'];
  for (let x = 40; x < PLANTA.LARGURA; x += 40) partes.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + PLANTA.ALTURA + '" stroke="#EEF2F7" stroke-width="1"/>');
  for (let y = 40; y < PLANTA.ALTURA; y += 40) partes.push('<line x1="0" y1="' + y + '" x2="' + PLANTA.LARGURA + '" y2="' + y + '" stroke="#EEF2F7" stroke-width="1"/>');
  mesas.forEach(m => {
    const cap = Math.max(1, Number(m.Capacidade) || 0), ocup = oc[m.ID_Mesa] || 0, vip = m.VIP === 'Sim';
    const borda = ocup > cap ? '#EF4444' : (vip ? '#F59E0B' : (ocup >= cap ? '#16A34A' : '#1B2A6B'));
    const fundo = vip ? '#FEF3C7' : '#FFFFFF';
    const g = ['<g transform="translate(' + (Number(m.Pos_X) || 0) + ',' + (Number(m.Pos_Y) || 0) + ')">'];
    const cadeira = (x, y, i) => g.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7.5" fill="' + (i < ocup ? '#1B2A6B' : '#FFFFFF') + '" stroke="' + (i < ocup ? 'none' : '#CBD5E1') + '" stroke-width="1.5"/>');
    let meiaAltura;
    if (_s_(m.Formato) === 'Retangular') {
      const porLado = Math.ceil(cap / 2), w = Math.max(70, 26 + porLado * 24), h = 46, passo = (w - 16) / porLado;
      for (let i = 0; i < cap; i++) { const lado = i < porLado ? -1 : 1, k = i < porLado ? i : i - porLado; cadeira(-w / 2 + 8 + passo * (k + .5), lado * (h / 2 + 12), i); }
      g.push('<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="10" fill="' + fundo + '" stroke="' + borda + '" stroke-width="2.2"/>');
      meiaAltura = h / 2;
    } else {
      const r = Math.min(62, Math.max(30, 20 + cap * 2.6)), R = r + 14;
      for (let i = 0; i < cap; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / cap; cadeira(Math.cos(a) * R, Math.sin(a) * R, i); }
      g.push('<circle r="' + r + '" fill="' + fundo + '" stroke="' + borda + '" stroke-width="2.2"/>');
      meiaAltura = r;
    }
    g.push('<text y="-1" text-anchor="middle" font-size="17" font-weight="700" fill="#0F172A">' + _h_(m.Numero) + '</text>');
    g.push('<text y="15" text-anchor="middle" font-size="10.5" fill="#64748B">' + ocup + '/' + cap + '</text>');
    if (_s_(m.Nome)) g.push('<text y="' + (meiaAltura + 34) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#1B2A6B">' + _h_(_s_(m.Nome).slice(0, 24)) + '</text>');
    if (vip) g.push('<text y="' + (-meiaAltura - 22) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#B45309" letter-spacing="1">VIP</text>');
    g.push('</g>');
    partes.push(g.join(''));
  });
  partes.push('</svg>');
  return partes.join('');
}

function _relMesas_(idEvento, op, sessao) {
  const ctx = _contextoEvento_(idEvento);
  const e = ctx.evento;
  const mesas = _mesasDoEvento_(idEvento);
  const oc = _ocupacaoMesas_(idEvento);
  const sentam = ctx.convites.filter(x => _ocupaLugar_(x.c));
  const porMesa = {};
  sentam.forEach(x => { if (x.c.ID_Mesa) (porMesa[x.c.ID_Mesa] = porMesa[x.c.ID_Mesa] || []).push(x); });
  const idsMesa = {}; mesas.forEach(m => idsMesa[m.ID_Mesa] = true);
  const semMesa = sentam.filter(x => !idsMesa[x.c.ID_Mesa]).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const lugares = mesas.reduce((t, m) => t + (Number(m.Capacidade) || 0), 0);
  const sentados = sentam.length - semMesa.length;

  const blocos = mesas.map(m => {
    const pessoas = (porMesa[m.ID_Mesa] || []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<div class="mesa-bloco' + (m.VIP === 'Sim' ? ' vip' : '') + '"><div class="mt"><span>' + _h_(_rotuloMesa_(m)) + (m.VIP === 'Sim' ? ' · VIP' : '') + '</span><span>' + pessoas.length + '/' + (Number(m.Capacidade) || 0) + '</span></div>' +
      (pessoas.length ? '<ol>' + pessoas.map(x => '<li>' + _h_(x.nome) + (x.empresa ? ' <small>· ' + _h_(x.empresa) + '</small>' : '') + (x.gestor ? ' <small>· por ' + _h_(x.gestor) + '</small>' : '') + (x.status === 'Convidado' ? ' <small>(sem resposta)</small>' : '') + '</li>').join('') + '</ol>'
        : '<div class="vazio" style="padding:6px 8px">Mesa vazia.</div>') + '</div>';
  });

  return _documento_({
    kicker: 'Mapa de Mesas', titulo: _s_(e.Nome),
    subtitulo: [_s_(e.Local), 'Planta do salão e distribuição dos convidados'].filter(Boolean).join(' • '),
    status: _statusEvento_(e),
    direita: [{ r: 'Data do evento', v: _fmtData_(e.Data) || 'A definir' }],
    codigo: _codigoDoc_('MES', e.ID_Evento), sessao: sessao, arquivo: 'Mapa de mesas - ' + _s_(e.Nome),
    secoes: [
      _secao_('01', 'Resumo da ocupação', '', _kpis_([
        { r: 'Mesas', v: mesas.length, s: mesas.filter(m => m.VIP === 'Sim').length + ' VIP' },
        { r: 'Lugares', v: lugares, s: 'capacidade das mesas' },
        { r: 'Sentados', v: sentados, s: _fmtPct_(_pct_(sentados, lugares)) + ' dos lugares', cor: '#16A34A' },
        { r: 'Sem mesa', v: semMesa.length, s: 'convidados ativos', cor: semMesa.length ? '#EF4444' : '' },
        { r: 'Lugares livres', v: Math.max(0, lugares - sentados), s: '' }
      ])),
      _secao_('02', 'Planta do salão', 'Cadeira escura = ocupada · borda dourada = VIP',
        mesas.length ? '<div class="planta">' + _svgPlanta_(mesas, oc) + '</div>' : '<div class="vazio">Nenhuma mesa cadastrada.</div>'),
      _secao_('03', 'Convidados por mesa', sentados + ' convidado(s) em ' + mesas.length + ' mesa(s)',
        blocos.length ? '<div class="mesas-grade">' + blocos.join('') + '</div>' : '<div class="vazio">Nenhuma mesa cadastrada.</div>'),
      _secao_('04', 'Sem mesa', semMesa.length + ' convidado(s)',
        semMesa.length ? _tabela_([{ t: 'Nº', cls: 'num' }, { t: 'Convidado' }, { t: 'Empresa' }, { t: 'Gestor' }, { t: 'Status', cls: 'n' }],
          semMesa.map((x, i) => '<tr><td class="num">' + (i + 1) + '</td><td><b>' + _h_(x.nome) + '</b></td><td>' + (_h_(x.empresa) || '—') + '</td><td>' + (_h_(x.gestor) || '—') + '</td><td class="n">' + _stTxt_(x.status) + '</td></tr>'))
          : '<div class="vazio">Todos os convidados ativos têm mesa.</div>')
    ]
  });
}

// ------------------------------------------------------------
// 4) PANORAMA / COMPARATIVO (um ou vários eventos)
// opcoes: { eventos: [ids] } (vazio = todos)
// ------------------------------------------------------------
function _relPanorama_(op, sessao) {
  let eventos = dbListar_(DB.EVENTOS);
  const ids = (op.eventos || []).map(_s_).filter(Boolean);
  if (ids.length) eventos = eventos.filter(e => ids.indexOf(_s_(e.ID_Evento)) !== -1);
  if (!eventos.length) throw new Error('Selecione pelo menos um evento.');
  eventos.sort((a, b) => new Date(a.Data || 0) - new Date(b.Data || 0));
  const idsSel = {}; eventos.forEach(e => idsSel[e.ID_Evento] = true);

  const pessoas = {}, empresas = {};
  dbListar_(DB.PESSOAS).forEach(p => pessoas[p.ID_Pessoa] = p);
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = e.Nome);
  const convites = dbListar_(DB.CONVITES, c => idsSel[c.ID_Evento] && _conviteAtivo_(c));

  const porEvento = {}, porGestor = {}, porCat = {}, porOrigem = {}, porEmpresa = {};
  convites.forEach(c => {
    const r = porEvento[c.ID_Evento] = porEvento[c.ID_Evento] || { t: 0, c: 0, p: 0, r: 0 };
    const conf = c.Status === 'Confirmado' || c.Status === 'Presente', pres = c.Status === 'Presente';
    r.t++; if (conf) r.c++; if (pres) r.p++; if (c.Status === 'Recusado') r.r++;
    const g = _s_(c.Gestor) || 'Sem gestor';
    const rg = porGestor[g] = porGestor[g] || { t: 0, c: 0, p: 0, ev: {} };
    rg.t++; if (conf) rg.c++; if (pres) rg.p++; rg.ev[c.ID_Evento] = true;
    const p = pessoas[c.ID_Pessoa] || {};
    const cat = _s_(p.Categoria) || 'Outro'; porCat[cat] = (porCat[cat] || 0) + 1;
    const ori = _s_(c.Origem) || 'Lista original'; porOrigem[ori] = (porOrigem[ori] || 0) + 1;
    const emp = _s_(empresas[p.ID_Empresa]);
    if (emp) { const re = porEmpresa[emp] = porEmpresa[emp] || { t: 0, p: 0 }; re.t++; if (pres) re.p++; }
  });

  const tot = { t: convites.length, c: 0, p: 0, esperados: 0 };
  convites.forEach(c => { if (c.Status === 'Confirmado' || c.Status === 'Presente') tot.c++; if (c.Status === 'Presente') tot.p++; if (c.Status !== 'Recusado') tot.esperados++; });
  const realizados = eventos.filter(e => (porEvento[e.ID_Evento] || {}).p > 0);
  const datas = eventos.map(e => e.Data).filter(Boolean);
  const periodo = datas.length ? _fmtData_(datas[0]) + (datas.length > 1 ? ' a ' + _fmtData_(datas[datas.length - 1]) : '') : 'sem datas definidas';

  const linhasEv = eventos.map(e => {
    const r = porEvento[e.ID_Evento] || { t: 0, c: 0, p: 0, r: 0 };
    const cap = Number(e.Capacidade) || 0;
    const pres = _pct_(r.p, r.t - r.r), conf = _pct_(r.c, r.t);
    return '<tr><td><b>' + _h_(e.Nome) + '</b>' + (e.Local ? '<span class="sub">' + _h_(e.Local) + '</span>' : '') + '</td>' +
      '<td style="white-space:nowrap">' + (_fmtData_(e.Data) || '—') + '</td><td class="n">' + (cap || '—') + '</td><td class="n">' + r.t + '</td>' +
      '<td class="n">' + r.c + ' <span class="sub" style="display:inline">(' + _fmtPct_(conf) + ')</span></td><td class="n">' + r.p + '</td>' +
      '<td class="n">' + (r.p ? _miniBarra_(pres) + _fmtPct_(pres) : '<span style="color:#CBD5E1">—</span>') + '</td>' +
      '<td class="n">' + (cap ? _fmtPct_(_pct_(r.t, cap)) : '—') + '</td></tr>';
  });

  const linhasG = Object.keys(porGestor).sort((a, b) => porGestor[b].t - porGestor[a].t).map(g => {
    const r = porGestor[g];
    return '<tr><td><b>' + _h_(g) + '</b></td><td class="n">' + Object.keys(r.ev).length + '</td><td class="n">' + r.t + '</td><td class="n">' + r.c + '</td><td class="n">' + r.p + '</td>' +
      '<td class="n">' + _miniBarra_(_pct_(r.c, r.t), '#1E3A8A') + _fmtPct_(_pct_(r.c, r.t)) + '</td></tr>';
  });

  const cats = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a]);
  const oris = Object.keys(porOrigem).sort((a, b) => porOrigem[b] - porOrigem[a]);
  const coresOri = { 'Lista original': '#1E3A8A', 'Lote público': '#0D9488', 'Walk-in': '#F97316', 'Substituição': '#64748B' };
  const emps = Object.keys(porEmpresa).sort((a, b) => porEmpresa[b].t - porEmpresa[a].t).slice(0, 10);

  const unico = eventos.length === 1;
  return _documento_({
    kicker: unico ? 'Panorama do Evento' : 'Panorama Comparativo de Eventos',
    titulo: unico ? _s_(eventos[0].Nome) : eventos.length + ' eventos selecionados',
    subtitulo: 'Indicadores de convites, confirmação e presença',
    direita: [{ r: 'Período', v: periodo }, { r: 'Eventos', v: String(eventos.length) }],
    codigo: _codigoDoc_('PAN', eventos.length + 'EV'), sessao: sessao, arquivo: 'Panorama de eventos',
    secoes: [
      _secao_('01', 'Escopo e indicadores gerais', eventos.length + ' evento(s) · ' + periodo, _kpis_([
        { r: 'Eventos', v: eventos.length, s: realizados.length + ' com check-in' },
        { r: 'Convidados', v: tot.t, s: 'convites ativos' },
        { r: 'Confirmados', v: tot.c, s: _fmtPct_(_pct_(tot.c, tot.t)) + ' de confirmação', cor: '#1E3A8A' },
        { r: 'Presentes', v: tot.p, s: _fmtPct_(_pct_(tot.p, tot.esperados)) + ' de presença', cor: '#16A34A' },
        { r: 'Empresas', v: Object.keys(porEmpresa).length, s: 'representadas' }
      ])),
      _secao_('02', 'Comparativo entre eventos', 'Presença = presentes ÷ esperados (sem recusas)',
        _tabela_([{ t: 'Evento' }, { t: 'Data' }, { t: 'Capac.', cls: 'n' }, { t: 'Lista', cls: 'n' }, { t: 'Confirmados', cls: 'n' }, { t: 'Presentes', cls: 'n' }, { t: 'Presença', cls: 'n' }, { t: 'Ocupação', cls: 'n' }], linhasEv)),
      _secao_('03', 'Desempenho por gestor', Object.keys(porGestor).length + ' gestor(es)',
        linhasG.length ? _tabela_([{ t: 'Gestor' }, { t: 'Eventos', cls: 'n' }, { t: 'Convidados', cls: 'n' }, { t: 'Confirmados', cls: 'n' }, { t: 'Presentes', cls: 'n' }, { t: 'Confirmação', cls: 'n' }], linhasG) : '<div class="vazio">Sem convites.</div>'),
      _secao_('04', 'Perfil do público', '',
        '<div class="grade2"><div><div class="kicker" style="margin-bottom:8px">Categorias</div>' +
          (cats.length ? cats.slice(0, 12).map(c => _barra_(c, porCat[c], tot.t, '#1E3A8A')).join('') : '<div class="vazio">—</div>') +
        '</div><div class="col-borda"><div class="kicker" style="margin-bottom:8px">Origem dos convites</div>' +
          (oris.length ? oris.map(o => _barra_(o, porOrigem[o], tot.t, coresOri[o] || '#64748B')).join('') : '<div class="vazio">—</div>') +
        '</div></div>'),
      _secao_('05', 'Empresas mais representadas', emps.length ? 'Top ' + emps.length : '',
        emps.length ? _tabela_([{ t: 'Nº', cls: 'num' }, { t: 'Empresa' }, { t: 'Convidados', cls: 'n' }, { t: 'Presentes', cls: 'n' }],
          emps.map((n, i) => '<tr><td class="num">' + (i + 1) + '</td><td><b>' + _h_(n) + '</b></td><td class="n">' + porEmpresa[n].t + '</td><td class="n">' + porEmpresa[n].p + '</td></tr>'))
          : '<div class="vazio">Nenhum convidado vinculado a empresa.</div>')
    ]
  });
}

// ------------------------------------------------------------
// 5) BASE DE CONTATOS POR GESTOR (pessoas no banco)
// Uma pessoa pertence ao gestor que a cadastrou (Gestor_Responsavel)
// e a todo gestor que já a convidou — por isso pode aparecer em mais de
// uma tabela. opcoes: { gestor, documento, contato }
// ------------------------------------------------------------
function _baseContatos_() {
  const empresas = {}, eventos = {};
  dbListar_(DB.EMPRESAS).forEach(e => empresas[e.ID_Empresa] = _s_(e.Nome));
  dbListar_(DB.EVENTOS).forEach(e => eventos[e.ID_Evento] = e);
  const info = {};
  dbListar_(DB.CONVITES).forEach(c => {
    const x = info[c.ID_Pessoa] = info[c.ID_Pessoa] || { gestores: {}, listas: 0, presencas: 0, ultimo: null };
    if (c.Gestor) x.gestores[_s_(c.Gestor)] = true;
    if (_conviteAtivo_(c) || c.Status === 'Presente') x.listas++;
    if (c.Status === 'Presente') x.presencas++;
    const ev = eventos[c.ID_Evento];
    if (ev && (!x.ultimo || new Date(ev.Data || 0) > new Date(x.ultimo.Data || 0))) x.ultimo = ev;
  });
  const pessoas = dbListar_(DB.PESSOAS).map(p => {
    const x = info[p.ID_Pessoa] || { gestores: {}, listas: 0, presencas: 0, ultimo: null };
    const gestores = Object.assign({}, x.gestores);
    if (_s_(p.Gestor_Responsavel)) gestores[_s_(p.Gestor_Responsavel)] = true;
    return {
      p: p, nome: _s_(p.Nome) || '(sem nome)', cargo: _s_(p.Cargo), categoria: _s_(p.Categoria) || 'Outro',
      empresa: _s_(empresas[p.ID_Empresa]), documento: _s_(p.Documento),
      contato: [_s_(p.Telefone), _s_(p.Email)].filter(Boolean).join(' · '),
      gestores: Object.keys(gestores), listas: x.listas, presencas: x.presencas,
      ultimo: x.ultimo ? _s_(x.ultimo.Nome) + (x.ultimo.Data ? ' (' + _fmtData_(x.ultimo.Data) + ')' : '') : ''
    };
  });
  return { pessoas: pessoas, totalEmpresas: Object.keys(empresas).length };
}

function _relBase_(op, sessao) {
  const base = _baseContatos_();
  const todos = base.pessoas;
  const filtro = _s_(op.gestor);
  const grupos = {};
  todos.forEach(x => {
    const gs = x.gestores.length ? x.gestores : [''];
    gs.forEach(g => { if (!filtro || g === filtro) (grupos[g] = grupos[g] || []).push(x); });
  });
  const nomesG = Object.keys(grupos).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, 'pt-BR'));
  const universo = filtro ? (grupos[filtro] || []) : todos;
  const convidadas = universo.filter(x => x.listas).length;
  const participaram = universo.filter(x => x.presencas).length;

  const cols = [{ t: 'Nº', cls: 'num' }, { t: 'Pessoa' }, { t: 'Empresa' }, { t: 'Categoria' }];
  if (op.documento) cols.push({ t: 'Documento' });
  if (op.contato) cols.push({ t: 'Contato' });
  cols.push({ t: 'Listas', cls: 'n' }, { t: 'Presenças', cls: 'n' }, { t: 'Último evento' });

  const tabelas = nomesG.map(g => {
    const itens = grupos[g].slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const linhas = itens.map((x, i) => '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td><b>' + _h_(x.nome) + '</b>' + (x.cargo ? '<span class="sub">' + _h_(x.cargo) + '</span>' : '') + '</td>' +
      '<td>' + (_h_(x.empresa) || '<span style="color:#CBD5E1">—</span>') + '</td><td>' + _h_(x.categoria) + '</td>' +
      (op.documento ? '<td style="white-space:nowrap">' + (_h_(x.documento) || '—') + '</td>' : '') +
      (op.contato ? '<td>' + (_h_(x.contato) || '—') + '</td>' : '') +
      '<td class="n">' + x.listas + '</td><td class="n">' + (x.presencas ? '<b style="color:#16A34A">' + x.presencas + '</b>' : '0') + '</td>' +
      '<td><span class="sub" style="font-size:7.4pt">' + (_h_(x.ultimo) || 'nunca convidada') + '</span></td></tr>');
    const part = itens.filter(x => x.presencas).length;
    return '<div class="grupo"><div class="grupo-tit"><div><span class="g">Gestor</span><span class="nome">' + _h_(g || 'Sem gestor definido') + '</span></div>' +
      '<div class="cont">' + itens.length + ' pessoa(s) · ' + part + ' já participaram</div></div>' + _tabela_(cols, linhas) + '</div>';
  });

  // Resumo por gestor + categorias
  const resumoG = nomesG.map(g => {
    const it = grupos[g];
    return '<tr><td><b>' + _h_(g || 'Sem gestor definido') + '</b></td><td class="n">' + it.length + '</td><td class="n">' + it.filter(x => x.listas).length + '</td>' +
      '<td class="n">' + it.filter(x => x.presencas).length + '</td><td class="n">' + _miniBarra_(_pct_(it.filter(x => x.presencas).length, it.length)) + _fmtPct_(_pct_(it.filter(x => x.presencas).length, it.length)) + '</td></tr>';
  });
  const porCat = {};
  universo.forEach(x => porCat[x.categoria] = (porCat[x.categoria] || 0) + 1);
  const cats = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a]);

  return _documento_({
    kicker: 'Relatório da Base de Contatos',
    titulo: filtro ? 'Contatos de ' + filtro : 'Pessoas cadastradas no sistema',
    subtitulo: 'Cadastros organizados por gestor responsável',
    direita: [{ r: 'Pessoas', v: String(universo.length) }, { r: 'Gestores', v: String(nomesG.filter(Boolean).length) }],
    codigo: _codigoDoc_('BAS', filtro ? 'G' : 'GERAL'), sessao: sessao, arquivo: 'Base de contatos' + (filtro ? ' - ' + filtro : ''),
    secoes: [
      _secao_('01', 'Visão geral da base', filtro ? 'Filtro: ' + filtro : 'Base completa', _kpis_([
        { r: 'Pessoas', v: universo.length, s: filtro ? 'deste gestor' : 'no banco' },
        { r: 'Empresas', v: filtro ? Object.keys(universo.reduce((o, x) => { if (x.empresa) o[x.empresa] = 1; return o; }, {})).length : base.totalEmpresas, s: 'representadas' },
        { r: 'Já convidadas', v: convidadas, s: _fmtPct_(_pct_(convidadas, universo.length)) + ' da base', cor: '#1E3A8A' },
        { r: 'Já participaram', v: participaram, s: _fmtPct_(_pct_(participaram, universo.length)) + ' da base', cor: '#16A34A' },
        { r: 'Nunca convidadas', v: universo.length - convidadas, s: 'potencial para próximos eventos' }
      ]) + '<div class="grade2" style="margin-top:16px"><div>' +
        _tabela_([{ t: 'Gestor' }, { t: 'Pessoas', cls: 'n' }, { t: 'Convidadas', cls: 'n' }, { t: 'Participaram', cls: 'n' }, { t: 'Participação', cls: 'n' }], resumoG) +
        '</div><div class="col-borda" style="flex:0 0 36%"><div class="kicker" style="margin-bottom:8px">Categorias</div>' +
        cats.slice(0, 10).map(c => _barra_(c, porCat[c], universo.length, '#1E3A8A')).join('') + '</div></div>' +
        (filtro ? '' : '<p class="texto" style="margin-top:10px;font-size:7.6pt;color:#64748B">Uma pessoa aparece na tabela de cada gestor que a cadastrou ou já a convidou; por isso a soma das tabelas pode ser maior que o total da base.</p>')),
      _secao_('02', 'Pessoas por gestor', universo.length + ' pessoa(s)', tabelas.length ? tabelas.join('') : '<div class="vazio">Nenhuma pessoa para este filtro.</div>')
    ]
  });
}

function apiGestoresDaBase(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const nomes = {};
  _baseContatos_().pessoas.forEach(x => x.gestores.forEach(g => nomes[g] = true));
  return { ok: true, dados: Object.keys(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR')) };
}

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
const TIPOS_RELATORIO = { lista: _relLista_, presenca: _relPresenca_, mesas: _relMesas_ };

function apiGerarRelatorio(token, tipo, opcoes) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'relatorios', 'exportar');
    opcoes = opcoes || {};
    let html;
    if (tipo === 'panorama') html = _relPanorama_(opcoes, s);
    else if (tipo === 'base') html = _relBase_(opcoes, s);
    else if (TIPOS_RELATORIO[tipo]) {
      if (!opcoes.idEvento) throw new Error('Evento não informado.');
      html = TIPOS_RELATORIO[tipo](opcoes.idEvento, opcoes, s);
    } else throw new Error('Tipo de relatório inválido.');
    logAudit_('REPORT', 'Relatorios', tipo, 'Relatório "' + tipo + '" gerado por ' + rotuloSessao_(s));
    return { ok: true, dados: { html: html } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Planilha (CSV) com os mesmos dados — abre direto no Excel.
function apiCsvRelatorio(token, tipo, opcoes) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  try {
    _exigirPermissao_(s, 'relatorios', 'exportar');
    opcoes = opcoes || {};
    let cab, linhas, nome;
    if (tipo === 'base') {
      const filtro = _s_(opcoes.gestor);
      cab = ['Gestor(es)', 'Nome', 'Cargo', 'Empresa', 'Categoria', 'Documento', 'Telefone', 'E-mail', 'Listas', 'Presenças', 'Último evento'];
      linhas = _baseContatos_().pessoas.filter(x => !filtro || x.gestores.indexOf(filtro) !== -1)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map(x => [x.gestores.join(', '), x.nome, x.cargo, x.empresa, x.categoria, x.documento, _s_(x.p.Telefone), _s_(x.p.Email), x.listas, x.presencas, x.ultimo]);
      nome = 'base-contatos' + (filtro ? '-' + filtro.toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 30) : '');
    } else if (tipo === 'panorama') {
      const ids = (opcoes.eventos || []).map(_s_);
      const evs = dbListar_(DB.EVENTOS, e => !ids.length || ids.indexOf(_s_(e.ID_Evento)) !== -1);
      const conv = dbListar_(DB.CONVITES, c => _conviteAtivo_(c));
      cab = ['Evento', 'Data', 'Local', 'Capacidade', 'Na lista', 'Confirmados', 'Presentes', 'Recusados'];
      linhas = evs.map(e => {
        const cs = conv.filter(c => c.ID_Evento === e.ID_Evento);
        return [_s_(e.Nome), _fmtData_(e.Data), _s_(e.Local), Number(e.Capacidade) || '', cs.length,
          cs.filter(c => c.Status === 'Confirmado' || c.Status === 'Presente').length,
          cs.filter(c => c.Status === 'Presente').length, cs.filter(c => c.Status === 'Recusado').length];
      });
      nome = 'panorama-eventos';
    } else {
      const ctx = _contextoEvento_(opcoes.idEvento);
      const base = opcoes.incluirInativos ? ctx.convites : ctx.convites.filter(x => _conviteAtivo_(x.c));
      cab = ['Gestor', 'Nome', 'Cargo', 'Empresa', 'Categoria', 'Documento', 'Telefone', 'E-mail', 'Status', 'Origem', 'Mesa', 'Check-in'];
      linhas = base.sort((a, b) => a.gestor.localeCompare(b.gestor, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR')).map(x => [
        x.gestor, x.nome, x.cargo, x.empresa, x.categoria, x.documento, _s_(x.p.Telefone), _s_(x.p.Email),
        x.status, x.origem, x.mesa, _fmtData_(x.c.Checkin_DataHora, 'dd/MM/yyyy HH:mm')]);
      nome = tipo + '-' + _s_(ctx.evento.Nome).toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    }
    return { ok: true, dados: { cabecalho: cab, linhas: linhas, arquivo: nome + '-' + _fmtData_(new Date(), 'yyyyMMdd') + '.csv' } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}
