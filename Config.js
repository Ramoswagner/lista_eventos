/**
 * CONFIG.gs
 * Arquivo central de configuração do sistema.
 */

const CONFIG = {
  APP_NAME: 'Sistema de Eventos - Hospital da Baleia',
  SPREADSHEET_ID: '13nzyrdq772Xk-L2OSUYiGy0SJsZ3wGI1rzDGoyKCMyQ',
  TIMEZONE: 'America/Sao_Paulo',
  LOGO_PADRAO: 'https://hospitaldabaleia.org.br/wp-content/uploads/2023/08/Ativo-3@2x.png'
};

// Funções auxiliares para acessar o CONFIG
function getConfig() { return CONFIG; }
function getSpreadsheetId() { return CONFIG.SPREADSHEET_ID; }

// ------------------------------------------------------------
// LOGO DA INSTITUIÇÃO — configurável pelo Admin em Configurações.
// Guardada na aba "Config" (DB.CONFIG) como uma URL do Google Drive.
// Pública (sem token) porque a logo precisa aparecer até na tela de
// login e nas páginas públicas de convite/confirmação.
// ------------------------------------------------------------
function _configObter(chave, padrao) {
  const linha = dbListar(DB.CONFIG, c => c.Chave === chave)[0];
  return (linha && linha.Valor) || padrao;
}
function _configSalvar(chave, valor) {
  const existente = dbListar(DB.CONFIG, c => c.Chave === chave)[0];
  if (existente) dbAtualizar(DB.CONFIG, chave, { Valor: valor, Atualizado_Em: new Date() });
  else dbInserir(DB.CONFIG, { Chave: chave, Valor: valor, Atualizado_Em: new Date() });
}

function apiLogoPublico() {
  const url = _configObter('LOGO_URL', '');
  return { ok: true, dados: {
    url:           url || CONFIG.LOGO_PADRAO,
    escala:        Number(_configObter('LOGO_ESCALA', 1)) || 1,
    personalizada: !!url
  } };
}

// Volta pra logo padrão (não mexe no tamanho/escala escolhido).
function apiRemoverLogo(token) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador remove a logo.' };
    const urlAtual = _configObter('LOGO_URL', '');
    if (!urlAtual) return { ok: true, mensagem: 'Já está usando a logo padrão.', dados: { url: CONFIG.LOGO_PADRAO } };
    const idDrive = urlAtual.indexOf('lh3.googleusercontent.com/d/') !== -1 ? urlAtual.split('/d/')[1] : null;
    dbExcluir(DB.CONFIG, 'LOGO_URL');
    if (idDrive) { try { DriveApp.getFileById(idDrive).setTrashed(true); } catch (e) {} }
    return { ok: true, mensagem: 'Logo padrão restaurada.', dados: { url: CONFIG.LOGO_PADRAO } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

function apiSalvarLogo(token, base64DataUri, nomeArquivo) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador troca a logo.' };
    if (!base64DataUri || base64DataUri.indexOf('base64,') === -1) throw new Error('Arquivo inválido.');

    const partes = base64DataUri.split('base64,');
    const contentType = partes[0].replace('data:', '').replace(';', '');
    if (contentType.indexOf('image/') !== 0) throw new Error('Envie um arquivo de imagem (PNG, JPG ou SVG).');
    const bytes = Utilities.base64Decode(partes[1]);
    const blob = Utilities.newBlob(bytes, contentType, nomeArquivo || 'logo');

    const arquivo = DriveApp.createFile(blob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://lh3.googleusercontent.com/d/' + arquivo.getId();

    const urlAntiga = _configObter('LOGO_URL', '');
    const antigoId = urlAntiga.indexOf('lh3.googleusercontent.com/d/') !== -1 ? urlAntiga.split('/d/')[1] : null;

    _configSalvar('LOGO_URL', url);
    if (antigoId) { try { DriveApp.getFileById(antigoId).setTrashed(true); } catch (e) {} }

    return { ok: true, mensagem: 'Logo atualizada para todos.', dados: { url } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}

// Tamanho de exibição da logo (não precisa reenviar o arquivo pra ajustar).
function apiSalvarLogoEscala(token, escala) {
  try {
    const s = validarSessao(token);
    if (!s) return NEGADO;
    if (s.perfil !== 'Admin') return { ok: false, mensagem: 'Apenas o administrador ajusta o tamanho da logo.' };
    const n = Number(escala);
    if (!n || n < 0.5 || n > 2) throw new Error('Tamanho inválido (entre 50% e 200%).');
    _configSalvar('LOGO_ESCALA', n);
    return { ok: true, mensagem: 'Tamanho da logo atualizado.', dados: { escala: n } };
  } catch (e) { return { ok: false, mensagem: e.message }; }
}