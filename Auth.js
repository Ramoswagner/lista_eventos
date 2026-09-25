/**
 * ============================================================
 * AUTH.GS - Autenticação, sessões e gestão de acessos
 * ============================================================
 * Modelo: cada linha da aba Gestores é um login.
 *   Setor + Senha = credencial
 *   Perfil = Admin | Gestor | Organizador | Recepcao | Consulta
 * Senha: hash SHA-256 com salt (nunca gravada em texto).
 * Sessão: token UUID no CacheService com TTL de 6 horas.
 * ============================================================
 */

const AUTH = {
  SALT: 'HB-EVENTOS-2026',
  TTL_SEGUNDOS: 21600  // 6 horas
};

// ------------------------------------------------------------
// PERFIS E PERMISSÕES
// Ver (ler) é liberado para todo login ativo. A matriz abaixo diz quem
// pode ALTERAR cada coisa. O Admin pode mudar isso na tela
// Configurações → Permissões (guardado na aba Config). O Admin sempre
// pode tudo, e só o Admin mexe em logins e permissões.
// ------------------------------------------------------------
const PERFIS = ['Admin', 'Gestor', 'Organizador', 'Recepcao', 'Consulta'];
const PERFIL_ROTULO = { Admin: 'Administrador', Gestor: 'Gestor', Organizador: 'Organizador', Recepcao: 'Recepção', Consulta: 'Consulta' };

// Ações configuráveis (o que aparece no painel de permissões).
const ACOES_PERMISSAO = [
  { modulo: 'eventos',  acao: 'criar',   rotulo: 'Criar eventos' },
  { modulo: 'eventos',  acao: 'editar',  rotulo: 'Editar eventos' },
  { modulo: 'eventos',  acao: 'excluir', rotulo: 'Excluir eventos' },
  { modulo: 'pessoas',  acao: 'criar',   rotulo: 'Cadastrar pessoas no diretório' },
  { modulo: 'empresas', acao: 'criar',   rotulo: 'Cadastrar empresas' },
  { modulo: 'convites', acao: 'criar',   rotulo: 'Adicionar pessoas à lista de um evento' },
  { modulo: 'convites', acao: 'excluir', rotulo: 'Cancelar convites' },
  { modulo: 'lotes',    acao: 'criar',   rotulo: 'Criar lotes (link para empresas)' },
  { modulo: 'lotes',    acao: 'editar',  rotulo: 'Encerrar / reabrir lotes' },
  { modulo: 'checkin',  acao: 'criar',   rotulo: 'Registrar entradas (check-in, walk-in, substituição)' }
];

const PERMISSOES_PADRAO = {
  Gestor:      ['eventos.criar','eventos.editar','eventos.excluir','pessoas.criar','empresas.criar','convites.criar','convites.excluir','lotes.criar','lotes.editar','checkin.criar'],
  Organizador: ['pessoas.criar','convites.criar'],
  Recepcao:    ['checkin.criar'],
  Consulta:    []
};

// Perfil "Organizacao" das versões antigas tinha os poderes do Gestor.
function _perfilNormalizado_(perfil) {
  const p = _s_(perfil);
  if (p === 'Organizacao') return 'Gestor';
  return PERFIS.indexOf(p) !== -1 ? p : 'Consulta';
}

let _permissoesCache_ = null;
function _matrizPermissoes_() {
  if (_permissoesCache_) return _permissoesCache_;
  let salvas = null;
  try { salvas = JSON.parse(_configObter_('PERMISSOES', '') || 'null'); } catch (e) { salvas = null; }
  const m = {};
  Object.keys(PERMISSOES_PADRAO).forEach(p => {
    m[p] = ((salvas && Array.isArray(salvas[p])) ? salvas[p] : PERMISSOES_PADRAO[p]).slice();
  });
  _permissoesCache_ = m;
  return m;
}

// ------------------------------------------------------------
// HASH DE SENHA (SHA-256 + salt)
// ------------------------------------------------------------
function hashSenha_(senha) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    AUTH.SALT + '|' + (senha || '')
  ).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------
// PRIMEIRO ACESSO — execute uma vez no editor
// ------------------------------------------------------------
const ADMIN_PADRAO = { SETOR: 'adm', SENHA: '1234' };

// Funções de manutenção (rodar pelo editor) chamam isto primeiro.
// Sem esta trava, qualquer visitante da página pública conseguiria
// chamá-las pelo navegador (google.script.run chama toda função cujo
// nome não termina em "_"). No editor, quem executa é o próprio dono;
// um visitante anônimo não tem e-mail ativo.
function _somenteEditor_() {
  let ativo = '';
  try { ativo = Session.getActiveUser().getEmail(); } catch (e) { ativo = ''; }
  const dono = Session.getEffectiveUser().getEmail();
  if (!ativo || ativo !== dono) throw new Error('Execute esta função pelo editor do Apps Script.');
}

function _criarAdminPadrao_() {
  const jaExiste = dbListar_(DB.GESTORES, g => g.Perfil === 'Admin' && g.Ativo !== 'Não');
  if (jaExiste.length) return jaExiste[0];
  return dbInserir_(DB.GESTORES, {
    Nome: 'Administrador', Setor: ADMIN_PADRAO.SETOR, Perfil: 'Admin',
    Senha_Hash: hashSenha_(ADMIN_PADRAO.SENHA), Ativo: 'Sim', Criado_Em: new Date()
  });
}

function criarAdminInicial() {
  _somenteEditor_();
  const jaExiste = dbListar_(DB.GESTORES, g => g.Perfil === 'Admin' && g.Ativo !== 'Não');
  if (jaExiste.length) {
    Logger.log('Já existe um administrador: ' + jaExiste[0].Nome + ' (setor: ' + jaExiste[0].Setor + ')');
    return;
  }
  _criarAdminPadrao_();
  Logger.log('✅ Admin criado. Setor: "' + ADMIN_PADRAO.SETOR + '" / Senha: "' + ADMIN_PADRAO.SENHA + '"');
}

// Esqueceu a senha? Abra o editor do Apps Script deste projeto, selecione
// a função "resetAdmin" na barra de execução e clique em Executar.
// Isso redefine o login do administrador para setor "adm" / senha "1234".
function resetAdmin() {
  _somenteEditor_();
  const admins = dbListar_(DB.GESTORES, g => g.Perfil === 'Admin');
  if (admins.length) {
    dbAtualizar_(DB.GESTORES, admins[0].ID_Gestor, { Setor: ADMIN_PADRAO.SETOR, Senha_Hash: hashSenha_(ADMIN_PADRAO.SENHA), Ativo: 'Sim' });
    CacheService.getScriptCache().remove('loginfalhas_' + ADMIN_PADRAO.SETOR);
    Logger.log('Admin resetado: setor "' + ADMIN_PADRAO.SETOR + '" / senha "' + ADMIN_PADRAO.SENHA + '"');
  } else {
    _criarAdminPadrao_();
    Logger.log('Admin criado: setor "' + ADMIN_PADRAO.SETOR + '" / senha "' + ADMIN_PADRAO.SENHA + '"');
  }
}

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------
// Limite de tentativas: 5 senhas erradas seguidas no mesmo usuário
// bloqueiam novas tentativas por 10 minutos.
const LOGIN_MAX_FALHAS = 5;
const LOGIN_BLOQUEIO_SEG = 600;

function apiLogin(setor, senha) {
  try {
    const setorNorm = _s_(setor).toLowerCase();
    if (!setorNorm || !senha) return { ok: false, mensagem: 'Informe setor e senha.' };

    const cache = CacheService.getScriptCache();
    const chaveFalhas = 'loginfalhas_' + setorNorm;
    const falhas = Number(cache.get(chaveFalhas) || 0);
    if (falhas >= LOGIN_MAX_FALHAS) {
      return { ok: false, mensagem: 'Muitas tentativas erradas. Aguarde 10 minutos e tente de novo.' };
    }

    // Primeiro acesso: se não existe nenhum gestor cadastrado ainda,
    // cria o admin padrão (adm / 1234) automaticamente.
    if (!dbListar_(DB.GESTORES).length) _criarAdminPadrao_();

    const hash = hashSenha_(senha);
    const candidatos = dbListar_(DB.GESTORES, g =>
      g.Ativo !== 'Não' && _s_(g.Setor).toLowerCase() === setorNorm
    );
    const achou = candidatos.filter(g => _s_(g.Senha_Hash) === hash)[0];
    if (!achou) {
      cache.put(chaveFalhas, String(falhas + 1), LOGIN_BLOQUEIO_SEG);
      return { ok: false, mensagem: 'Setor ou senha incorretos.' };
    }
    cache.remove(chaveFalhas);

    const token = Utilities.getUuid();
    const sessao = {
      id_gestor: achou.ID_Gestor,
      gestor:    _s_(achou.Nome),
      setor:     _s_(achou.Setor),
      perfil:    _perfilNormalizado_(achou.Perfil)
    };
    sessao.permissoes = _permissoesDoPerfil_(sessao.perfil);
    cache.put('sess_' + token, JSON.stringify(sessao), AUTH.TTL_SEGUNDOS);
    // Avisa na tela para trocar a senha padrão do administrador.
    const senhaPadrao = setorNorm === ADMIN_PADRAO.SETOR && senha === ADMIN_PADRAO.SENHA;
    return { ok: true, dados: Object.assign({ token, senhaPadrao }, sessao) };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

// ------------------------------------------------------------
// VALIDAÇÃO DE SESSÃO
// ------------------------------------------------------------
// Login real ativo (Index.html pede setor/senha via apiLogin e guarda o
// token no sessionStorage do navegador). Mude para true só para depurar
// sem precisar logar.
const BYPASS_LOGIN = false;

// Uma chamada como apiBootstrapEvento valida a mesma sessão várias
// vezes (cada sub-função valida) — guarda o resultado na execução.
const _sessaoMemo_ = {};

function validarSessao_(token) {
  if (!token) return null;
  if (_sessaoMemo_.hasOwnProperty(token)) return _sessaoMemo_[token];
  const s = _validarSessaoSemMemo_(token);
  _sessaoMemo_[token] = s;
  return s;
}

function _validarSessaoSemMemo_(token) {
  if (BYPASS_LOGIN) {
    return { id_gestor: 'admin', gestor: 'Administrador Master', setor: 'admin', perfil: 'Admin' };
  }
  return _validarSessaoReal_(token);
}

// Além do token, confere na aba Gestores se o login continua ativo e
// usa o perfil atual — desativar um login ou trocar o perfil vale na
// hora, sem esperar a sessão de 6h expirar.
function _validarSessaoReal_(token) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) return null;
  const sessao = JSON.parse(raw);
  const g = dbBuscarPorId_(DB.GESTORES, sessao.id_gestor);
  if (!g || g.Ativo === 'Não') { cache.remove('sess_' + token); return null; }
  sessao.perfil = _perfilNormalizado_(g.Perfil);
  sessao.gestor = _s_(g.Nome);
  sessao.permissoes = _permissoesDoPerfil_(sessao.perfil);
  cache.put('sess_' + token, JSON.stringify(sessao), AUTH.TTL_SEGUNDOS);
  return sessao;
}

function rotuloSessao_(s) { return s.gestor + ' · ' + s.setor; }

function temPermissao_(perfil, modulo, acao) {
  const p = _perfilNormalizado_(perfil);
  if (p === 'Admin') return true;
  if (acao === 'ler') return modulo !== 'logins' && modulo !== 'audit';
  if (modulo === 'logins' || modulo === 'audit') return false;
  const lista = _matrizPermissoes_()[p] || [];
  return lista.indexOf(modulo + '.' + acao) !== -1;
}

// Lista do que o perfil pode fazer — a tela usa para esconder botões.
function _permissoesDoPerfil_(perfil) {
  const p = _perfilNormalizado_(perfil);
  const r = {};
  ACOES_PERMISSAO.forEach(a => { r[a.modulo + '.' + a.acao] = temPermissao_(p, a.modulo, a.acao); });
  return r;
}

// ------------------------------------------------------------
// PAINEL DE PERMISSÕES (somente Admin)
// ------------------------------------------------------------
function apiObterPermissoes(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito ao administrador.' };
  return { ok: true, dados: {
    perfis: Object.keys(PERMISSOES_PADRAO).map(p => ({ perfil: p, rotulo: PERFIL_ROTULO[p] })),
    acoes: ACOES_PERMISSAO,
    matriz: _matrizPermissoes_()
  } };
}

function apiSalvarPermissoes(token, matriz) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera permissões.' };
    const validas = ACOES_PERMISSAO.map(a => a.modulo + '.' + a.acao);
    const limpa = {};
    Object.keys(PERMISSOES_PADRAO).forEach(p => {
      const lista = (matriz && Array.isArray(matriz[p])) ? matriz[p] : [];
      limpa[p] = lista.filter(x => validas.indexOf(x) !== -1);
    });
    _configSalvar_('PERMISSOES', JSON.stringify(limpa));
    _permissoesCache_ = null;
    return { ok: true, mensagem: 'Permissões salvas. Valem na próxima ação de cada usuário.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiRestaurarPermissoesPadrao(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador altera permissões.' };
  if (_configObter_('PERMISSOES', '')) dbExcluir_(DB.CONFIG, 'PERMISSOES');
  _permissoesCache_ = null;
  return { ok: true, mensagem: 'Permissões padrão restauradas.' };
}

// ------------------------------------------------------------
// LOGOUT
// ------------------------------------------------------------
function apiSair(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { ok: true };
}

// ------------------------------------------------------------
// GESTÃO DE LOGINS (somente Admin)
// ------------------------------------------------------------
function apiCriarLogin(token, dados) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador cadastra logins.' };
    if (!dados || !_s_(dados.Nome) || !_s_(dados.Setor) || !dados.Senha) throw new Error('Nome, setor e senha são obrigatórios.');
    if (String(dados.Senha).length < 4) throw new Error('Senha muito curta (mínimo 4 caracteres).');
    _validarPerfil_(dados.Perfil);
    const nomeN  = _s_(dados.Nome).toLowerCase();
    const setorN = _s_(dados.Setor).toLowerCase();
    const igual  = dbListar_(DB.GESTORES, g =>
      _s_(g.Nome).toLowerCase() === nomeN &&
      _s_(g.Setor).toLowerCase() === setorN
    );
    if (igual.length) throw new Error('Este gestor já possui login neste setor.');
    dbInserir_(DB.GESTORES, {
      Nome: _s_(dados.Nome), Setor: _s_(dados.Setor),
      Perfil: dados.Perfil || 'Recepcao', Senha_Hash: hashSenha_(dados.Senha),
      Cargo: _s_(dados.Cargo), Ativo: 'Sim', Criado_Em: new Date()
    });
    return { ok: true, mensagem: 'Login criado para ' + dados.Nome + '.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiListarLogins(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
  return { ok: true, dados: dbListar_(DB.GESTORES).map(g => ({
    id: g.ID_Gestor, nome: _s_(g.Nome), setor: _s_(g.Setor),
    cargo: _s_(g.Cargo), perfil: _s_(g.Perfil) || 'Recepcao', ativo: _s_(g.Ativo) || 'Sim'
  })) };
}

function apiEditarLogin(token, idGestor, dados) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
    const g = dbBuscarPorId_(DB.GESTORES, idGestor);
    if (!g) throw new Error('Login não encontrado.');
    if (!dados || !_s_(dados.Nome) || !_s_(dados.Setor)) throw new Error('Nome e setor são obrigatórios.');
    _validarPerfil_(dados.Perfil);
    if (g.Perfil === 'Admin' && dados.Perfil && dados.Perfil !== 'Admin') _protegerUltimoAdmin_(idGestor);
    const novos = { Nome: _s_(dados.Nome), Setor: _s_(dados.Setor), Cargo: _s_(dados.Cargo), Perfil: dados.Perfil || g.Perfil };
    if (dados.Senha) { if (String(dados.Senha).length < 4) throw new Error('Senha muito curta (mínimo 4 caracteres).'); novos.Senha_Hash = hashSenha_(dados.Senha); }
    dbAtualizar_(DB.GESTORES, idGestor, novos);
    return { ok: true, mensagem: 'Login de ' + novos.Nome + ' atualizado.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiAlternarLogin(token, idGestor) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
    const g = dbBuscarPorId_(DB.GESTORES, idGestor);
    if (!g) throw new Error('Login não encontrado.');
    const novo = g.Ativo === 'Não' ? 'Sim' : 'Não';
    if (novo === 'Não') _protegerUltimoAdmin_(idGestor);
    dbAtualizar_(DB.GESTORES, idGestor, { Ativo: novo });
    return { ok: true, mensagem: g.Nome + ' agora está ' + (novo === 'Sim' ? 'ativo' : 'inativo') + '.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function _validarPerfil_(perfil) {
  if (perfil && PERFIS.indexOf(perfil) === -1) throw new Error('Perfil inválido.');
}

// ------------------------------------------------------------
// SENHAS
// Cada usuário troca a própria senha (precisa da senha atual).
// O Admin redefine a senha de qualquer login (para quem esqueceu).
// ------------------------------------------------------------
function apiTrocarMinhaSenha(token, senhaAtual, novaSenha) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    const g = dbBuscarPorId_(DB.GESTORES, s.id_gestor);
    if (!g) throw new Error('Login não encontrado.');
    if (_s_(g.Senha_Hash) !== hashSenha_(senhaAtual)) throw new Error('A senha atual está incorreta.');
    if (!novaSenha || String(novaSenha).length < 4) throw new Error('A nova senha precisa ter pelo menos 4 caracteres.');
    if (novaSenha === senhaAtual) throw new Error('A nova senha precisa ser diferente da atual.');
    dbAtualizar_(DB.GESTORES, s.id_gestor, { Senha_Hash: hashSenha_(novaSenha) });
    return { ok: true, mensagem: 'Senha alterada.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiRedefinirSenhaLogin(token, idGestor, novaSenha) {
  try {
    const s = validarSessao_(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador redefine senhas.' };
    const g = dbBuscarPorId_(DB.GESTORES, idGestor);
    if (!g) throw new Error('Login não encontrado.');
    if (!novaSenha || String(novaSenha).length < 4) throw new Error('A nova senha precisa ter pelo menos 4 caracteres.');
    dbAtualizar_(DB.GESTORES, idGestor, { Senha_Hash: hashSenha_(novaSenha) });
    CacheService.getScriptCache().remove('loginfalhas_' + _s_(g.Setor).toLowerCase());
    return { ok: true, mensagem: 'Senha de ' + _s_(g.Nome) + ' redefinida. Passe a nova senha para a pessoa.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function _protegerUltimoAdmin_(idSendoAlterado) {
  const outrosAdmins = dbListar_(DB.GESTORES, g =>
    g.Perfil === 'Admin' && g.Ativo !== 'Não' && g.ID_Gestor !== idSendoAlterado
  );
  if (!outrosAdmins.length) throw new Error('Operação bloqueada: este é o único administrador ativo.');
}

function apiListarGestoresNomes(token) {
  const s = validarSessao_(token);
  if (!s) return NEGADO;
  const nomes = {};
  dbListar_(DB.GESTORES, g => g.Ativo !== 'Não').forEach(g => nomes[g.Nome] = true);
  return { ok: true, dados: Object.keys(nomes).sort() };
}
