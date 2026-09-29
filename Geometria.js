/**
 * ============================================================
 * GEOMETRIA.GS - Geometria do salão e das mesas (em centímetros)
 * ============================================================
 * Módulo único, usado no servidor (relatório em PDF, validação) e na
 * tela (editor da planta): getViewContent injeta este mesmo código na
 * página de Mesas, então as contas são idênticas nos dois lados.
 * Não usa nada de fora da função (nem planilha, nem Apps Script).
 *
 * O que ocupa espaço no salão:
 *   tampo da mesa (tamanho real)
 *   + cadeira: faixa em volta do tampo (padrão 55 cm = cadeira ~45 cm
 *     + ~10 cm para afastar e sentar)
 *   + corredor: espaço livre entre os encostos de mesas vizinhas
 *   + distância das paredes e folga para os elementos (palco, pista...)
 *
 * Formatos de salão: retângulo, L, T, U, I (H) e oval.
 * Elementos: retangulares ou redondos/ovais.
 * ============================================================
 */
function _geoSalao_() {
  var CADEIRA_PADRAO = 55;
  var FORMAS = ['retangulo', 'L', 'T', 'U', 'I', 'oval'];
  var ORIENTACOES = {
    L: ['inf-dir', 'inf-esq', 'sup-dir', 'sup-esq'],   // canto recortado
    T: ['baixo', 'cima', 'dir', 'esq'],                // para onde vai a haste
    U: ['cima', 'baixo', 'esq', 'dir'],                // lado da abertura
    I: ['vertical', 'horizontal']                      // direção da parte central
  };

  // Tamanho de tampo usual no mercado de eventos, pelo nº de lugares (cm).
  function tamanhoPadrao(formato, cap) {
    cap = Math.max(1, Number(cap) || 1);
    if (formato === 'Retangular') return { c: Math.max(120, Math.ceil(cap / 2) * 60), l: 80 };
    if (formato === 'Quadrada') { var s = Math.max(80, Math.ceil(cap / 4) * 65); return { c: s, l: s }; }
    var d = cap <= 4 ? 90 : cap <= 6 ? 120 : cap <= 8 ? 150 : cap <= 10 ? 160 : cap <= 12 ? 180 : Math.round(cap * 50 / Math.PI);
    return { c: d, l: d };
  }

  // Área ocupada pela mesa com as cadeiras. m: { formato, comp, larg, rot }.
  function pegada(m, cadeira) {
    var cad = cadeira || CADEIRA_PADRAO;
    var larg = m.formato === 'Redonda' ? m.comp : (m.formato === 'Quadrada' ? m.comp : m.larg);
    var w = m.comp + 2 * cad, h = larg + 2 * cad;
    if (m.formato === 'Retangular') w = m.comp + 20;       // cadeiras só nos lados compridos
    var r = m.rot === 90 ? { w: h, h: w } : { w: w, h: h };
    r.redonda = m.formato === 'Redonda';
    return r;
  }

  // Cadeiras em volta do tampo (relativo ao centro, já girado).
  function assentos(m, n, cadeira) {
    var pts = [], af = Math.max(18, Math.round((cadeira || CADEIRA_PADRAO) * 0.45));
    var c = m.comp, l = m.formato === 'Retangular' ? m.larg : m.comp, i, k, porLado;
    if (m.formato === 'Retangular') {
      porLado = Math.max(1, Math.ceil(n / 2));
      for (i = 0; i < n; i++) { var lado = i < porLado ? -1 : 1; k = i < porLado ? i : i - porLado; pts.push({ x: -c / 2 + c * (k + .5) / porLado, y: lado * (l / 2 + af) }); }
    } else if (m.formato === 'Quadrada') {
      porLado = Math.max(1, Math.ceil(n / 4));
      for (i = 0; i < n; i++) {
        var ld = Math.floor(i / porLado), pos = -c / 2 + c * ((i % porLado) + .5) / porLado, d = c / 2 + af;
        pts.push(ld === 0 ? { x: pos, y: -d } : ld === 1 ? { x: d, y: pos } : ld === 2 ? { x: -pos, y: d } : { x: -d, y: -pos });
      }
    } else {
      var R = c / 2 + af;
      for (i = 0; i < n; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; pts.push({ x: Math.cos(a) * R, y: Math.sin(a) * R }); }
    }
    return m.rot === 90 ? pts.map(function(p) { return { x: -p.y, y: p.x }; }) : pts;
  }

  // ---------------------------------------------------------- contorno do salão
  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Contorno em cm dentro do retângulo W x H.
  // Retorna { tipo:'poli', pts:[{x,y}] } ou { tipo:'elipse', cx, cy, rx, ry }.
  function contorno(p) {
    var W = p.w, H = p.h, f = p.forma || {}, tipo = FORMAS.indexOf(f.tipo) !== -1 ? f.tipo : 'retangulo';
    if (tipo === 'oval') return { tipo: 'elipse', cx: W / 2, cy: H / 2, rx: W / 2, ry: H / 2 };
    if (tipo === 'retangulo') return { tipo: 'poli', pts: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }] };
    var o = f.orient || ORIENTACOES[tipo][0];
    var transp = (tipo === 'T' || tipo === 'U') ? (o === 'dir' || o === 'esq') : (tipo === 'I' && o === 'horizontal');
    var bw = transp ? H : W, bh = transp ? W : H;          // moldura da forma-base
    var a = limitar(Number(f.a) || bw / 3, 50, bw - 50), b = limitar(Number(f.b) || bh / 3, 50, bh - 50);
    var pts;
    if (tipo === 'L') {             // base: canto inferior direito recortado (a x b)
      pts = [[0, 0], [bw, 0], [bw, bh - b], [bw - a, bh - b], [bw - a, bh], [0, bh]];
    } else if (tipo === 'T') {      // base: barra em cima (prof. b), haste para baixo (larg. a)
      pts = [[0, 0], [bw, 0], [bw, b], [(bw + a) / 2, b], [(bw + a) / 2, bh], [(bw - a) / 2, bh], [(bw - a) / 2, b], [0, b]];
    } else if (tipo === 'U') {      // base: abertura em cima (larg. a, prof. b)
      pts = [[0, 0], [(bw - a) / 2, 0], [(bw - a) / 2, b], [(bw + a) / 2, b], [(bw + a) / 2, 0], [bw, 0], [bw, bh], [0, bh]];
    } else {                        // I: abas em cima e embaixo (prof. b), centro (larg. a)
      b = Math.min(b, bh / 2 - 50);
      pts = [[0, 0], [bw, 0], [bw, b], [(bw + a) / 2, b], [(bw + a) / 2, bh - b], [bw, bh - b], [bw, bh], [0, bh], [0, bh - b], [(bw - a) / 2, bh - b], [(bw - a) / 2, b], [0, b]];
    }
    pts = pts.map(function(q) { return { x: q[0], y: q[1] }; });
    if (transp) pts = pts.map(function(q) { return { x: q.y, y: q.x }; });
    var espX = (tipo === 'L' && (o === 'inf-esq' || o === 'sup-esq')) || (tipo === 'T' && o === 'esq') || (tipo === 'U' && o === 'dir');
    var espY = (tipo === 'L' && (o === 'sup-dir' || o === 'sup-esq')) || (tipo === 'T' && o === 'cima') || (tipo === 'U' && o === 'baixo');
    if (espX) pts = pts.map(function(q) { return { x: W - q.x, y: q.y }; });
    if (espY) pts = pts.map(function(q) { return { x: q.x, y: H - q.y }; });
    return { tipo: 'poli', pts: pts };
  }

  function pontoDentro(fm, x, y) {
    if (fm.tipo === 'elipse') { var dx = (x - fm.cx) / fm.rx, dy = (y - fm.cy) / fm.ry; return dx * dx + dy * dy <= 1.0001; }
    var dentro = false, pts = fm.pts;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) dentro = !dentro;
    }
    return dentro;
  }

  function distPontoSeg(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L)) : 0;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  // O segmento atravessa o interior do retângulo? (recorte de Liang-Barsky)
  function segCortaRet(a, b, r) {
    var x0 = r.x - r.w / 2 + 0.5, x1 = r.x + r.w / 2 - 0.5, y0 = r.y - r.h / 2 + 0.5, y1 = r.y + r.h / 2 - 0.5;
    var dx = b.x - a.x, dy = b.y - a.y, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
    }
    return t0 <= t1;
  }

  // A caixa (mesa com cadeiras), afastada "margem" das paredes, cabe inteira no salão?
  function caixaDentro(fm, cx, margem) {
    var m = margem || 0, i;
    if (cx.redonda) {
      var R = cx.w / 2 + m;
      for (i = 0; i < 16; i++) { var a = i * Math.PI / 8; if (!pontoDentro(fm, cx.x + Math.cos(a) * R, cx.y + Math.sin(a) * R)) return false; }
      if (fm.tipo === 'poli') for (i = 0; i < fm.pts.length; i++) if (distPontoSeg(cx.x, cx.y, fm.pts[i], fm.pts[(i + 1) % fm.pts.length]) < R - 0.5) return false;
      return true;
    }
    var r = { x: cx.x, y: cx.y, w: cx.w + 2 * m, h: cx.h + 2 * m };
    var amostras = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];
    for (i = 0; i < amostras.length; i++) if (!pontoDentro(fm, r.x + amostras[i][0] * r.w / 2, r.y + amostras[i][1] * r.h / 2)) return false;
    if (fm.tipo === 'elipse') {       // mais pontos na borda para a curva
      for (i = 0; i < 8; i++) { var t = (i + .5) / 8; if (!pontoDentro(fm, r.x - r.w / 2 + t * r.w, r.y - r.h / 2) || !pontoDentro(fm, r.x - r.w / 2 + t * r.w, r.y + r.h / 2)) return false; }
      return true;
    }
    for (i = 0; i < fm.pts.length; i++) if (segCortaRet(fm.pts[i], fm.pts[(i + 1) % fm.pts.length], r)) return false;
    return true;
  }

  // ---------------------------------------------------------- folgas
  // Distância livre entre duas caixas {x,y,w,h,redonda|oval}. Negativa = sobrepõe.
  function folga(a, b) {
    if (b.oval && !a.oval) return folgaOval(a, b);
    if (a.oval && !b.oval) return folgaOval(b, a);
    if (a.redonda && b.redonda) return Math.hypot(a.x - b.x, a.y - b.y) - (a.w + b.w) / 2;
    if (a.oval && b.oval) return Math.hypot(a.x - b.x, a.y - b.y) - (Math.max(a.w, a.h) + Math.max(b.w, b.h)) / 2;
    return Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.h + b.h) / 2);
  }
  // Caixa (retângulo ou círculo) x elemento redondo/oval.
  function folgaOval(cx, el) {
    var rx = el.w / 2, ry = el.h / 2, dx = (cx.x - el.x) / rx, dy = (cx.y - el.y) / ry;
    if (dx * dx + dy * dy <= 1) return -1;                         // centro da mesa dentro do elemento
    if (Math.abs(el.x - cx.x) <= cx.w / 2 && Math.abs(el.y - cx.y) <= cx.h / 2) return -1;
    var menor = Infinity;
    for (var i = 0; i < 48; i++) {
      var a = i * Math.PI / 24, px = el.x + Math.cos(a) * rx, py = el.y + Math.sin(a) * ry;
      var d = cx.redonda ? Math.hypot(px - cx.x, py - cx.y) - cx.w / 2 : Math.max(Math.abs(px - cx.x) - cx.w / 2, Math.abs(py - cx.y) - cx.h / 2);
      if (d < menor) menor = d;
    }
    return menor;
  }

  // ---------------------------------------------------------- arranjo automático
  // p: { w, h, forma, fp:{w,h,redonda}, corredor, margem, arranjo:'grade'|'intercalada'|'blocos',
  //      central, encostar, obst:[{x,y,w,h,redonda?,oval?,folga}], palco:{x,y}|null }
  // Procura o encaixe da malha (deslocamentos) que coloca mais mesas dentro
  // do salão, sem invadir paredes, elementos nem mesas fixas.
  function gerarVagas(p) {
    var fm = contorno(p), fp = p.fp, c = p.corredor;
    var cw = fp.w + (p.encostar ? 0 : c), ch = fp.h + c;
    var hex = p.arranjo === 'intercalada';
    var passoY = hex && fp.redonda ? cw * Math.sqrt(3) / 2 : ch;
    var obst = p.obst || [];
    function valida(x, y) {
      if (p.arranjo === 'blocos' && Math.abs(x - p.w / 2) < p.central / 2 + fp.w / 2) return false;
      var cx = { x: x, y: y, w: fp.w, h: fp.h, redonda: fp.redonda };
      if (!caixaDentro(fm, cx, p.margem)) return false;
      for (var i = 0; i < obst.length; i++) {
        var o = obst[i];
        if (Math.abs(o.x - x) > (o.w + fp.w) / 2 + o.folga + 1 || Math.abs(o.y - y) > (o.h + fp.h) / 2 + o.folga + 1) continue;
        if (folga(cx, o) < o.folga - 0.5) return false;
      }
      return true;
    }
    var melhor = null, FX = 10, FY = 6;
    for (var ix = 0; ix < FX; ix++) {
      for (var iy = 0; iy < FY; iy++) {
        var fx = cw * ix / FX, fy = passoY * iy / FY, vagas = [], fila = 0;
        for (var y = fy; y <= p.h; y += passoY, fila++) {
          var desl = hex && fila % 2 ? cw / 2 : 0;
          for (var x = fx + desl - cw; x <= p.w; x += cw) {
            if (x < 0) continue;
            if (valida(x, y)) vagas.push({ x: Math.round(x), y: Math.round(y) });
          }
        }
        var n = vagas.length;
        if (!n) { if (!melhor) melhor = { vagas: [], desvio: 0 }; continue; }
        var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        vagas.forEach(function(v) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
        var desvio = Math.abs((x0 + x1) / 2 - p.w / 2) + Math.abs((y0 + y1) / 2 - p.h / 2);
        if (!melhor || n > melhor.vagas.length || (n === melhor.vagas.length && desvio < melhor.desvio - 1)) melhor = { vagas: vagas, desvio: desvio };
      }
    }
    var res = melhor ? melhor.vagas : [];
    // Ordem: fileira por fileira a partir da frente (lado do palco; sem palco, a parede de cima).
    var lado = 'topo';
    if (p.palco) {
      var d = { topo: p.palco.y, baixo: p.h - p.palco.y, esq: p.palco.x, dir: p.w - p.palco.x };
      lado = Object.keys(d).sort(function(a, b) { return d[a] - d[b]; })[0];
    }
    var vert = lado === 'topo' || lado === 'baixo';
    var prof = function(v) { return lado === 'topo' ? v.y : lado === 'baixo' ? -v.y : lado === 'esq' ? v.x : -v.x; };
    var trav = function(v) { return vert ? v.x : v.y; };
    var passo = vert ? passoY : cw;
    res.sort(function(a, b) { return Math.round(prof(a) / passo * 2) - Math.round(prof(b) / passo * 2) || trav(a) - trav(b); });
    return res;
  }

  // ---------------------------------------------------------- desenho / escala
  // Arestas do contorno com o comprimento (para as cotas).
  function arestas(fm) {
    if (fm.tipo !== 'poli') return [];
    var pts = fm.pts, area = 0, i;
    for (i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
    var sentido = area > 0 ? 1 : -1;
    return pts.map(function(a, k) {
      var b = pts[(k + 1) % pts.length], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, len: L, nx: sentido * dy / L, ny: -sentido * dx / L };
    });
  }

  function caminho(fm) {
    if (fm.tipo === 'elipse') return 'M ' + (fm.cx - fm.rx) + ' ' + fm.cy + ' a ' + fm.rx + ' ' + fm.ry + ' 0 1 0 ' + (2 * fm.rx) + ' 0 a ' + fm.rx + ' ' + fm.ry + ' 0 1 0 ' + (-2 * fm.rx) + ' 0 Z';
    return 'M ' + fm.pts.map(function(q) { return Math.round(q.x) + ' ' + Math.round(q.y); }).join(' L ') + ' Z';
  }

  // Comprimento "redondo" para a barra de escala (~1/5 da largura).
  function barraEscala(larguraCm) {
    var alvo = larguraCm / 5, opcoes = [100, 200, 500, 1000, 2000, 5000, 10000];
    for (var i = opcoes.length - 1; i >= 0; i--) if (opcoes[i] <= alvo) return opcoes[i];
    return 100;
  }

  // 160 -> "1,6 m"; 45 -> "0,45 m" (centímetros aparecem quando existem).
  function metros(cm) {
    var v = Math.round(Number(cm) || 0);
    var txt = v % 10 ? (v / 100).toFixed(2) : String(Math.round(v / 10) / 10);
    return txt.replace('.', ',') + ' m';
  }

  return {
    CADEIRA_PADRAO: CADEIRA_PADRAO, FORMAS: FORMAS, ORIENTACOES: ORIENTACOES,
    tamanhoPadrao: tamanhoPadrao, pegada: pegada, assentos: assentos,
    contorno: contorno, pontoDentro: pontoDentro, caixaDentro: caixaDentro,
    folga: folga, gerarVagas: gerarVagas, arestas: arestas, caminho: caminho,
    barraEscala: barraEscala, metros: metros
  };
}

// Instância do servidor (criada uma vez por execução).
var _geoMemo_ = null;
function _geo_() { return _geoMemo_ || (_geoMemo_ = _geoSalao_()); }
