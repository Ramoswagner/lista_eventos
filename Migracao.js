/**
 * ============================================================
 * MIGRACAO.GS — Diagnóstico e migração de dados legados
 * ============================================================
 * Execute no editor do Apps Script:
 *   1. diagnosticoSistema()  → ver o que existe na planilha
 *   2. migrarQRTokens()       → corrigir convites sem QR_Token
 *   3. setupCompleto()        → setup inicial completo (primeira vez)
 * ============================================================
 */

// ------------------------------------------------------------
// DIAGNÓSTICO: mostra todas as abas e quantas linhas têm
// ------------------------------------------------------------
function diagnosticoSistema() {
  const ss = _getSpreadsheet(); // usa openById(CONFIG.SPREADSHEET_ID)
  const abas = ss.getSheets();

  Logger.log('=== DIAGNÓSTICO DO SISTEMA ===');
  Logger.log('Planilha: ' + ss.getName() + ' (' + ss.getId() + ')');
  Logger.log('Total de abas: ' + abas.length);
  Logger.log('');

  const esperadas = Object.values(DB).map(s => s.nome);

  abas.forEach(aba => {
    const nome     = aba.getName();
    const linhas   = aba.getLastRow();
    const esperada = esperadas.indexOf(nome) !== -1 ? '✅' : '⚠️ (não usada pelo sistema)';
    Logger.log(esperada + ' [' + nome + '] — ' + linhas + ' linha(s)');
    if (linhas >= 1) {
      const cols = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1)).getValues()[0];
      Logger.log('   Colunas: ' + cols.filter(h => h).join(' | '));
    }
  });

  Logger.log('');
  Logger.log('=== CONVITES SEM QR_TOKEN ===');
  try {
    const convites = dbListar(DB.CONVITES);
    const semQR    = convites.filter(c => !c.QR_Token);
    Logger.log('Total de convites: ' + convites.length);
    Logger.log('Sem QR_Token: ' + semQR.length);
    if (semQR.length > 0) Logger.log('→ Execute migrarQRTokens() para corrigir.');
    else Logger.log('→ Todos os convites têm QR_Token. ✅');
  } catch (e) {
    Logger.log('Erro ao ler convites: ' + e.message);
  }

  Logger.log('');
  Logger.log('=== GESTORES/LOGINS ===');
  try {
    const gestores = dbListar(DB.GESTORES);
    Logger.log('Total de gestores: ' + gestores.length);
    gestores.forEach(g => Logger.log('  • ' + g.Nome + ' (' + g.Perfil + ') — setor: ' + g.Setor + ' — ativo: ' + g.Ativo));
    if (!gestores.length) Logger.log('→ Nenhum gestor. Execute criarAdminInicial().');
  } catch (e) {
    Logger.log('Erro ao ler gestores: ' + e.message);
  }
}

// ------------------------------------------------------------
// MIGRAÇÃO: gera QR_Token para convites que não têm
// Seguro rodar várias vezes (só toca quem está vazio)
// ------------------------------------------------------------
function migrarQRTokens() {
  Logger.log('=== MIGRANDO QR_TOKENS ===');
  try {
    const convites = dbListar(DB.CONVITES);
    let corrigidos = 0;
    convites.forEach(c => {
      if (!c.QR_Token || c.QR_Token.toString().trim() === '') {
        const novoToken = Utilities.getUuid();
        dbAtualizar(DB.CONVITES, c.ID_Convite, {
          QR_Token:  novoToken,
          QR_Valido: (c.Status === 'Cancelado' || c.Status === 'Substituído') ? 'Não' : 'Sim'
        });
        corrigidos++;
      }
    });
    Logger.log('✅ Corrigidos: ' + corrigidos + ' convite(s).');
    if (corrigidos === 0) Logger.log('Todos os convites já tinham QR_Token.');
  } catch (e) {
    Logger.log('❌ Erro: ' + e.message);
  }
}

// ------------------------------------------------------------
// SETUP COMPLETO (primeira vez no novo sistema):
//   1. Cria as abas novas (sem apagar as antigas)
//   2. Cria o admin inicial
//   3. Gera QR tokens nos convites existentes
// ------------------------------------------------------------
function setupCompleto() {
  Logger.log('=== SETUP COMPLETO ===');
  Logger.log('Planilha: ' + CONFIG.SPREADSHEET_ID);

  Logger.log('1. Criando estrutura do banco...');
  setupDatabase();

  Logger.log('2. Criando admin inicial...');
  criarAdminInicial();

  Logger.log('3. Migrando QR Tokens de convites existentes...');
  migrarQRTokens();

  Logger.log('✅ Setup concluído! Login: setor "admin" / senha "123"');
}
