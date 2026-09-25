/**
 * ============================================================
 * AUTH.GS - Autenticação, sessões e gestão de acessos
 * ============================================================
 * Modelo: cada linha da aba Gestores é um login.
 *   Setor + Senha = credencial
 *   Perfil = Admin | Organizacao | Recepcao | Consulta
 * Senha: hash SHA-256 com salt (nunca gravada em texto).
 * Sessão: token UUID no CacheService com TTL de 6 horas.
 * ============================================================
 */

const AUTH = {
  SALT: 'HB-EVENTOS-2026',
  TTL_SEGUNDOS: 21600  // 6 horas
};

const PERMISSOES = {
  Admin:       { eventos: ['criar','ler','editar','excluir'], pessoas: ['criar','ler','editar','excluir'], empresas: ['criar','ler','editar','excluir'], convites: ['criar','ler','editar','excluir'], lotes: ['criar','ler','editar','excluir'], mesas: ['criar','ler','editar','excluir'], checkin: ['criar','ler','editar'], relatorios: ['ler','exportar'], logins: ['criar','ler','editar','excluir'], audit: ['ler'] },
  Organizacao: { eventos: ['criar','ler','editar'], pessoas: ['criar','ler','editar'], empresas: ['criar','ler','editar'], convites: ['criar','ler','editar','excluir'], lotes: ['criar','ler','editar'], mesas: ['criar','ler','editar'], checkin: ['ler'], relatorios: ['ler','exportar'], logins: ['ler'], audit: [] },
  Recepcao:    { eventos: ['ler'], pessoas: ['ler'], empresas: ['ler'], convites: ['ler'], lotes: ['ler'], mesas: ['ler'], checkin: ['criar','ler','editar'], relatorios: ['ler'], logins: [], audit: [] },
  Consulta:    { eventos: ['ler'], pessoas: ['ler'], empresas: ['ler'], convites: ['ler'], lotes: ['ler'], mesas: ['ler'], checkin: ['ler'], relatorios: ['ler'], logins: [], audit: [] }
};

// ------------------------------------------------------------
// HASH DE SENHA (SHA-256 + salt)
// ------------------------------------------------------------
function hashSenha(senha) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    AUTH.SALT + '|' + (senha || '')
  ).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------
// PRIMEIRO ACESSO — execute uma vez no editor
// ------------------------------------------------------------
const ADMIN_PADRAO = { SETOR: 'adm', SENHA: '1234' };

function criarAdminInicial() {
  const jaExiste = dbListar(DB.GESTORES, g => g.Perfil === 'Admin' && g.Ativo !== 'Não');
  if (jaExiste.length) {
    Logger.log('Já existe um administrador: ' + jaExiste[0].Nome + ' (setor: ' + jaExiste[0].Setor + ')');
    return;
  }
  dbInserir(DB.GESTORES, {
    Nome: 'Administrador', Setor: ADMIN_PADRAO.SETOR, Perfil: 'Admin',
    Senha_Hash: hashSenha(ADMIN_PADRAO.SENHA), Ativo: 'Sim', Criado_Em: new Date()
  });
  Logger.log('✅ Admin criado. Setor: "' + ADMIN_PADRAO.SETOR + '" / Senha: "' + ADMIN_PADRAO.SENHA + '"');
}

// Esqueceu a senha? Abra Extensões > Apps Script neste projeto, selecione
// a função "resetAdmin" na barra de execução e clique em Executar.
// Isso redefine o login do administrador para setor "adm" / senha "1234".
function resetAdmin() {
  const admins = dbListar(DB.GESTORES, g => g.Perfil === 'Admin');
  if (admins.length) {
    dbAtualizar(DB.GESTORES, admins[0].ID_Gestor, { Setor: ADMIN_PADRAO.SETOR, Senha_Hash: hashSenha(ADMIN_PADRAO.SENHA), Ativo: 'Sim' });
    Logger.log('Admin resetado: setor "' + ADMIN_PADRAO.SETOR + '" / senha "' + ADMIN_PADRAO.SENHA + '"');
  } else {
    criarAdminInicial();
  }
}

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------
function apiLogin(setor, senha) {
  try {
    const setorNorm = (setor || '').trim().toLowerCase();
    if (!setorNorm || !senha) return { ok: false, mensagem: 'Informe setor e senha.' };

    // Primeiro acesso: se não existe nenhum gestor cadastrado ainda,
    // cria o admin padrão (adm / 1234) automaticamente.
    if (!dbListar(DB.GESTORES).length) criarAdminInicial();

    const hash = hashSenha(senha);
    const candidatos = dbListar(DB.GESTORES, g =>
      g.Ativo !== 'Não' && (g.Setor || '').trim().toLowerCase() === setorNorm
    );
    const achou = candidatos.filter(g => g.Senha_Hash === hash)[0];
    if (!achou) return { ok: false, mensagem: 'Setor ou senha incorretos.' };

    const token = Utilities.getUuid();
    const sessao = {
      id_gestor: achou.ID_Gestor,
      gestor:    achou.Nome,
      setor:     achou.Setor,
      perfil:    achou.Perfil || 'Recepcao'
    };
    CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sessao), AUTH.TTL_SEGUNDOS);
    return { ok: true, dados: Object.assign({ token }, sessao) };
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

function validarSessao(token) {
  if (!token) return null;
  if (BYPASS_LOGIN) {
    return { id_gestor: 'admin', gestor: 'Administrador Master', setor: 'admin', perfil: 'Admin' };
  }
  return _validarSessaoReal(token);
}

function _validarSessaoReal(token) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) return null;
  cache.put('sess_' + token, raw, AUTH.TTL_SEGUNDOS);
  return JSON.parse(raw);
}

function rotuloSessao(s) { return s.gestor + ' · ' + s.setor; }

function temPermissao(perfil, modulo, acao) {
  const perms = PERMISSOES[perfil];
  if (!perms || !perms[modulo]) return false;
  return perms[modulo].indexOf(acao) !== -1;
}

// ------------------------------------------------------------
// LOGOUT
// ------------------------------------------------------------
function apiSair(token) {
  CacheService.getScriptCache().remove('sess_' + token);
  return { ok: true };
}

// ------------------------------------------------------------
// GESTÃO DE LOGINS (somente Admin)
// ------------------------------------------------------------
function apiCriarLogin(token, dados) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador cadastra logins.' };
    if (!dados.Nome || !dados.Setor || !dados.Senha) throw new Error('Nome, setor e senha são obrigatórios.');
    if (dados.Senha.length < 3) throw new Error('Senha muito curta (mínimo 3 caracteres).');
    const nomeN  = dados.Nome.trim().toLowerCase();
    const setorN = dados.Setor.trim().toLowerCase();
    const igual  = dbListar(DB.GESTORES, g =>
      (g.Nome || '').trim().toLowerCase() === nomeN &&
      (g.Setor || '').trim().toLowerCase() === setorN
    );
    if (igual.length) throw new Error('Este gestor já possui login neste setor.');
    dbInserir(DB.GESTORES, {
      Nome: dados.Nome.trim(), Setor: dados.Setor.trim(),
      Perfil: dados.Perfil || 'Recepcao', Senha_Hash: hashSenha(dados.Senha),
      Cargo: dados.Cargo || '', Ativo: 'Sim', Criado_Em: new Date()
    });
    return { ok: true, mensagem: 'Login criado para ' + dados.Nome + '.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiListarLogins(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
  return { ok: true, dados: dbListar(DB.GESTORES).map(g => ({
    id: g.ID_Gestor, nome: g.Nome, setor: g.Setor || '',
    cargo: g.Cargo || '', perfil: g.Perfil || 'Recepcao', ativo: g.Ativo || 'Sim'
  })) };
}

function apiEditarLogin(token, idGestor, dados) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
    const g = dbBuscarPorId(DB.GESTORES, idGestor);
    if (!g) throw new Error('Login não encontrado.');
    if (!dados.Nome || !dados.Setor) throw new Error('Nome e setor são obrigatórios.');
    if (g.Perfil === 'Admin' && dados.Perfil !== 'Admin') _protegerUltimoAdmin(idGestor);
    const novos = { Nome: dados.Nome.trim(), Setor: dados.Setor.trim(), Cargo: dados.Cargo || '', Perfil: dados.Perfil || g.Perfil };
    if (dados.Senha) { if (dados.Senha.length < 3) throw new Error('Senha muito curta.'); novos.Senha_Hash = hashSenha(dados.Senha); }
    dbAtualizar(DB.GESTORES, idGestor, novos);
    return { ok: true, mensagem: 'Login de ' + novos.Nome + ' atualizado.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiAlternarLogin(token, idGestor) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Acesso restrito.' };
    const g = dbBuscarPorId(DB.GESTORES, idGestor);
    if (!g) throw new Error('Login não encontrado.');
    const novo = g.Ativo === 'Não' ? 'Sim' : 'Não';
    if (novo === 'Não') _protegerUltimoAdmin(idGestor);
    dbAtualizar(DB.GESTORES, idGestor, { Ativo: novo });
    return { ok: true, mensagem: g.Nome + ' agora está ' + (novo === 'Sim' ? 'ativo' : 'inativo') + '.' };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function _protegerUltimoAdmin(idSendoAlterado) {
  const outrosAdmins = dbListar(DB.GESTORES, g =>
    g.Perfil === 'Admin' && g.Ativo !== 'Não' && g.ID_Gestor !== idSendoAlterado
  );
  if (!outrosAdmins.length) throw new Error('Operação bloqueada: este é o único administrador ativo.');
}

function apiListarGestoresNomes(token) {
  const s = validarSessao(token);
  if (!s) return NEGADO;
  const nomes = {};
  dbListar(DB.GESTORES, g => g.Ativo !== 'Não').forEach(g => nomes[g.Nome] = true);
  return { ok: true, dados: Object.keys(nomes).sort() };
}
