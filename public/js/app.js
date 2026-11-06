/* =============================================================================
   escola-teste-nfe.js
   Escola Teste NF-e — Módulo Fiscal Escolar
   Integração com Focus NF via proxy /api/focus (mesma origem, sem CORS).
   =============================================================================
   Organização do arquivo:
     1.  BANCO DE DADOS LOCAL (DB)
     2.  UTILITÁRIOS GERAIS
     3.  ARMAZENAMENTO — Token e Persistência
     4.  CONFIGURAÇÃO — Emitente e Ambiente
     5.  API FOCUS — Requisições HTTP e Polling
     6.  DASHBOARD
     7.  VENDA / NF-e
     8.  NF-Ce (Fardamento)
     9.  HISTÓRICO — NF-e e NF-Ce
    10.  CANCELAMENTO
    11.  CONSULTA E ENVIO DE E-MAIL
    12.  ESTOQUE
    13.  CADASTROS — Livros, Kits, Alunos, Entradas
    14.  SUPABASE (configuração futura)
    15.  INICIALIZAÇÃO
============================================================================= */


/* =============================================================================
   1. BANCO DE DADOS LOCAL (DB)
   Objeto global que mantém todo o estado em memória.
   É persistido/recuperado via localStorage por saveDb() / loadDb().
============================================================================= */
var DB = {

  /* Produtos de fardamento (roupas/calçados) */
  fardamento: [
    { id: 101, nome: 'Uniforme escolar — conjunto esportivo', sku: 'FAR-001', ncm: '61051000', cfop: '5102', cst: '40', preco: 89.90, estoque: { 1: 20, 2: 15, 3: 12 }, estMin: 5 },
    { id: 102, nome: 'Calça escolar', sku: 'FAR-002', ncm: '62034200', cfop: '5102', cst: '40', preco: 129.90, estoque: { 1: 18, 2: 10, 3: 8 }, estMin: 5 },
    { id: 103, nome: 'Tênis escolar', sku: 'FAR-003', ncm: '64041100', cfop: '5102', cst: '40', preco: 199.90, estoque: { 1: 14, 2: 8, 3: 6 }, estMin: 3 },
    { id: 104, nome: 'Bermuda escolar', sku: 'FAR-004', ncm: '62034900', cfop: '5102', cst: '40', preco: 79.90, estoque: { 1: 22, 2: 12, 3: 10 }, estMin: 5 },
  ],

  /* Catálogo de livros didáticos */
  livros: [
    { id: 1, nome: 'Livro didático — Ensino Fundamental II, volume 2', sku: '0000000000182', serie: '8º ano EF', custo: 200, preco: 346.49, ncm: '49019900', cfop: '5117', cst: '41', estoque: { 1: 10, 2: 5, 3: 8 }, estMin: 3 },
    { id: 2, nome: 'Livro de atividades — Ensino Fundamental II, volume 2', sku: '0000000000838', serie: '8º ano EF', custo: 100, preco: 184.78, ncm: '49019900', cfop: '5117', cst: '41', estoque: { 1: 8, 2: 2, 3: 6 }, estMin: 3 },
    { id: 3, nome: 'Livro didático — Ensino Médio, volume 1', sku: '0000000000301', serie: '1º ano EM', custo: 150, preco: 290.00, ncm: '49019900', cfop: '5117', cst: '41', estoque: { 1: 2, 2: 7, 3: 4 }, estMin: 3 },
  ],

  /* Kits de livros pré-montados por segmento escolar */
  kits: [
    { id: 1, num: 1, nome: 'Kit 1 — Ensino Fundamental I', ano: 2026, series: '1º ao 5º ano EF', livros: [{ id: 1, qtd: 1, preco: 346.49 }, { id: 2, qtd: 1, preco: 184.78 }], ativo: true },
    { id: 2, num: 2, nome: 'Kit 2 — Ensino Fundamental II', ano: 2026, series: '6º ao 9º ano EF', livros: [{ id: 1, qtd: 1, preco: 346.49 }], ativo: true },
    { id: 3, num: 3, nome: 'Kit 3 — Ensino Médio', ano: 2026, series: '1º ao 3º ano EM', livros: [{ id: 3, qtd: 1, preco: 290.00 }], ativo: true },
  ],

  /* Matrículas de alunos com dados do responsável financeiro */
  alunos: [
    { id: 1, nome: 'ALUNO TESTE 1', serie: '8º ano EF', sede: 1, resp: 'RESPONSÁVEL TESTE 1', cpf: '000.000.000-00', email: 'responsavel1@example.com', fone: '00000000000' },
    { id: 2, nome: 'ALUNO TESTE 2', serie: '1º ano EM', sede: 1, resp: 'RESPONSÁVEL TESTE 2', cpf: '000.000.000-00', email: 'responsavel2@example.com', fone: '00000000000' },
    { id: 3, nome: 'ALUNO TESTE 3', serie: '8º ano EF', sede: 2, resp: 'RESPONSÁVEL TESTE 3', cpf: '000.000.000-00', email: 'responsavel3@example.com', fone: '00000000000' },
  ],

  /* Notas fiscais emitidas (NF-e e NF-Ce) */
  notas: [],
  notasNfce: [],

  /* Histórico de entradas de estoque */
  entradas: [],

  /* Contadores de sequência (persistidos junto com o DB) */
  nfCounter: 19170,
  nfceCounter: 1,

  /* Buffers temporários para montar um documento antes de salvar */
  kitTemp: { livros: [] },
  entradaTemp: [],

  /* Itens do carrinho de venda ativo */
  vendaItens: [],
  nfceItens: [],

  /* Responsável vinculado à venda em andamento */
  vendaResp: null,

  /* Sede selecionada globalmente */
  sedeAtiva: 1,
};


/* =============================================================================
   2. UTILITÁRIOS GERAIS
   Funções puras de formatação, conversão e escape.
============================================================================= */

/** Escapa caracteres especiais HTML para evitar XSS ao injetar innerHTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

/** Promessa que resolve após `ms` milissegundos (usado no polling da SEFAZ). */
function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/** Remove tudo que não for dígito de uma string (útil para CPF, CNPJ, CEP, etc.). */
function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Arredonda para 2 casas decimais e retorna string "0.00" (padrão Focus NF). */
function dec2(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

/** Formata Date para "YYYY-MM-DDTHH:MM:SS" no fuso local (sem offset). */
function isoLocal(d) {
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** Formata número em moeda BRL, sem o prefixo "R$". Ex: 1234.5 → "1.234,50" */
function R(v) {
  return parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formata número em moeda BRL com prefixo. Ex: 1234.5 → "R$ 1.234,50" */
function fmt(v) {
  return 'R$ ' + R(v);
}

/** Busca livro por id no DB. Retorna o objeto ou undefined. */
function gl(id) {
  return DB.livros.find(l => l.id == id);
}

/** Busca item de fardamento por id no DB. Retorna o objeto ou undefined. */
function glFard(id) {
  return DB.fardamento.find(function (f) { return f.id == id; });
}


/* =============================================================================
   3. ARMAZENAMENTO — Token e Persistência
   O token Focus NF pode ser mantido em localStorage (persistente entre sessões)
   ou em sessionStorage (apagado ao fechar o navegador), conforme preferência.
============================================================================= */

/** Lê o token de autenticação Focus NF do storage disponível. */
function getToken() {
  try {
    if (localStorage.getItem('escola_teste_persist_token') === '1')
      return localStorage.getItem('escola_teste_focus_token') || '';
    return sessionStorage.getItem('escola_teste_focus_token') || '';
  } catch (e) { return ''; }
}

/** Salva o token no storage. Se `persist` for true, usa localStorage; caso contrário, sessionStorage. */
function setToken(t, persist) {
  try {
    if (persist) {
      localStorage.setItem('escola_teste_persist_token', '1');
      localStorage.setItem('escola_teste_focus_token', t || '');
      sessionStorage.removeItem('escola_teste_focus_token');
    } else {
      localStorage.removeItem('escola_teste_persist_token');
      localStorage.removeItem('escola_teste_focus_token');
      sessionStorage.setItem('escola_teste_focus_token', t || '');
    }
  } catch (e) { }
}

/** Remove o token de todos os storages e notifica o usuário. */
function clearToken() {
  try {
    localStorage.removeItem('escola_teste_persist_token');
    localStorage.removeItem('escola_teste_focus_token');
    sessionStorage.removeItem('escola_teste_focus_token');
    var el = document.getElementById('cfg-token');
    if (el) el.value = '';
    notif2('Token apagado deste navegador.', '');
  } catch (e) { }
}

/**
 * Serializa o DB para JSON e grava em localStorage.
 * Dates são convertidas para ISO string antes de serializar.
 */
function saveDb() {
  try {
    var snap = {
      livros: DB.livros,
      fardamento: DB.fardamento,
      kits: DB.kits,
      alunos: DB.alunos,
      notas: DB.notas.map(function (n) {
        return Object.assign({}, n, { dhEmi: n.dhEmi instanceof Date ? n.dhEmi.toISOString() : n.dhEmi });
      }),
      notasNfce: DB.notasNfce.map(function (n) {
        return Object.assign({}, n, { dhEmi: n.dhEmi instanceof Date ? n.dhEmi.toISOString() : n.dhEmi });
      }),
      entradas: DB.entradas.map(function (e) {
        return Object.assign({}, e, { data: e.data instanceof Date ? e.data.toISOString() : e.data });
      }),
      nfCounter: DB.nfCounter,
      nfceCounter: DB.nfceCounter,
      sedeAtiva: DB.sedeAtiva,
    };
    localStorage.setItem('escola_teste_nf_escolar_db_v1', JSON.stringify(snap));
  } catch (e) { }
}

/**
 * Recupera o snapshot do localStorage e restaura o DB.
 * ISO strings de data são reconvertidas para objetos Date.
 */
function loadDb() {
  try {
    var raw = localStorage.getItem('escola_teste_nf_escolar_db_v1');
    if (!raw) return;
    var o = JSON.parse(raw);

    if (o.livros) DB.livros = o.livros;
    if (o.fardamento) DB.fardamento = o.fardamento;
    if (o.kits) DB.kits = o.kits;
    if (o.alunos) DB.alunos = o.alunos;
    if (o.notas) DB.notas = o.notas.map(function (n) { return Object.assign({}, n, { dhEmi: new Date(n.dhEmi) }); });
    if (o.notasNfce) DB.notasNfce = o.notasNfce.map(function (n) { return Object.assign({}, n, { dhEmi: new Date(n.dhEmi) }); });
    if (o.entradas) DB.entradas = o.entradas.map(function (e) { return Object.assign({}, e, { data: new Date(e.data) }); });
    if (o.nfCounter) DB.nfCounter = o.nfCounter;
    if (o.nfceCounter) DB.nfceCounter = o.nfceCounter;
    if (o.sedeAtiva) DB.sedeAtiva = o.sedeAtiva;
  } catch (e) { }
}

/** Exporta o DB atual para um arquivo JSON para download. */
function exportDb() {
  var data = JSON.stringify({
    livros: DB.livros,
    kits: DB.kits,
    alunos: DB.alunos,
    notas: DB.notas.map(function (n) { return Object.assign({}, n, { dhEmi: n.dhEmi instanceof Date ? n.dhEmi.toISOString() : n.dhEmi }); }),
    entradas: DB.entradas.map(function (e) { return Object.assign({}, e, { data: e.data instanceof Date ? e.data.toISOString() : e.data }); }),
    nfCounter: DB.nfCounter,
    sedeAtiva: DB.sedeAtiva,
  }, null, 2);

  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'escola-teste-nf-dados.json';
  a.click();
  URL.revokeObjectURL(a.href);
  notif2('Exportação gerada.', '');
}

/** Lê um arquivo JSON exportado anteriormente e restaura os dados no DB. */
function importDb(ev) {
  var f = ev.target.files && ev.target.files[0];
  if (!f) return;

  var r = new FileReader();
  r.onload = function () {
    try {
      var o = JSON.parse(r.result);
      if (o.livros) DB.livros = o.livros;
      if (o.kits) DB.kits = o.kits;
      if (o.alunos) DB.alunos = o.alunos;
      if (o.notas) DB.notas = o.notas.map(function (n) { return Object.assign({}, n, { dhEmi: new Date(n.dhEmi) }); });
      if (o.entradas) DB.entradas = o.entradas.map(function (e) { return Object.assign({}, e, { data: new Date(e.data) }); });
      if (o.nfCounter) DB.nfCounter = o.nfCounter;
      if (o.sedeAtiva) DB.sedeAtiva = o.sedeAtiva;

      syncSelects();
      renderLivros();
      renderKits();
      renderAlunos();
      updDash();
      updateEmptyBanner();
      saveDb();
      notif2('Dados importados.', '');
    } catch (e) {
      notif2('JSON inválido.', 'e');
    }
  };
  r.readAsText(f);
  ev.target.value = ''; // Limpa o input para permitir re-importação do mesmo arquivo
}


/* =============================================================================
   4. CONFIGURAÇÃO — Emitente e Ambiente
   Gerencia tokens, URLs da API, dados do emitente por sede e destino padrão.
============================================================================= */

/** Retorna a URL base da API Focus conforme o ambiente selecionado (prod/hom). */
function apiOrigin() {
  var amb = document.getElementById('cfg-amb').value;
  return amb === 'prod'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';
}

/**
 * Monta a URL completa para uma chamada à API.
 * Prioridade: proxy configurado → proxy /api/focus da mesma origem → URL direta.
 */
function buildFocusUrl(path) {
  var px = (document.getElementById('cfg-proxy') || { value: '' }).value.trim().replace(/\/$/, '');
  if (px) return px + (path.charAt(0) === '/' ? path : '/' + path);
  if (typeof location !== 'undefined' && location.origin)
    return location.origin + '/api/focus' + (path.charAt(0) === '/' ? path : '/' + path);
  return apiOrigin() + (path.charAt(0) === '/' ? path : '/' + path);
}

/** Retorna o header Authorization com o token em Basic Auth (senha vazia). */
function focusAuthHeader() {
  var token = getToken();
  if (!token) return {};
  return { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(token + ':'))) };
}

/** Atualiza o campo de URL exibido nas configurações. */
function refreshCfgUrl() {
  var el = document.getElementById('cfg-url');
  if (!el) return;
  var px = (document.getElementById('cfg-proxy') || { value: '' }).value.trim();
  if (px) { el.value = px + '/v2/…'; return; }
  if (typeof location !== 'undefined' && location.origin) { el.value = location.origin + '/api/focus/v2/…'; return; }
  el.value = apiOrigin() + '/v2/';
}

/** Mostra/oculta o bloco de dados do destinatário conforme o ambiente (apenas em produção). */
function toggleDestBlock() {
  var b = document.getElementById('v-dest-block');
  if (!b) return;
  var amb = document.getElementById('cfg-amb');
  b.style.display = amb && amb.value === 'prod' ? 'block' : 'none';
}

/** Salva as preferências da aba Configurações (token, ambiente, emitente). */
function saveCfg() {
  var t = (document.getElementById('cfg-token') || { value: '' }).value.trim();
  var persist = document.getElementById('cfg-persist') && document.getElementById('cfg-persist').checked;
  if (t) setToken(t, persist);
  else if (!persist) clearToken();
  refreshCfgUrl();
  saveDb();
  notif2('Preferências guardadas.', '');
}

/** Inicializa os campos visuais da aba Configurações ao abri-la. */
function initCfgUi() {
  var el = document.getElementById('cfg-token');
  if (!el) return;
  var t = getToken();
  if (t) el.placeholder = '(token já guardado — deixe em branco para manter)';
  var p = document.getElementById('cfg-persist');
  if (p) p.checked = localStorage.getItem('escola_teste_persist_token') === '1';
  refreshCfgUrl();
  toggleDestBlock();
}

/**
 * Dados fixos das três sedes emitentes.
 * Retorna objeto indexado por sedeId (1, 2, 3).
 */
function sedesEmit() {
  var unidade = {
    nome: 'ESCOLA TESTE',
    fant: 'ESCOLA TESTE',
    cnpj: '00.000.000/0000-00',
    cnpj14: '00000000000000',
    ie: '',
    logradouro_emitente: '',
    numero_emitente: '',
    bairro_emitente: '',
    municipio_emitente: '',
    uf_emitente: '',
    cep_emitente: '',
  };
  return { 1: Object.assign({}, unidade), 2: Object.assign({}, unidade), 3: Object.assign({}, unidade) };
}

/**
 * Lê os dados do emitente para a sede informada,
 * sobrescrevendo com valores digitados nos campos de configuração (se houver).
 */
function readEmitApi(sedeId) {
  var s = sedesEmit()[sedeId] || sedesEmit()[1];
  var nome = (document.getElementById('cfg-nome') || { value: '' }).value.trim() || s.nome;
  var fant = (document.getElementById('cfg-fant') || { value: '' }).value.trim() || s.fant;
  var cnpjEl = document.getElementById('cfg-cnpj1');
  var cnpj14 = digits(cnpjEl && cnpjEl.value ? cnpjEl.value : s.cnpj);
  var ie = digits((document.getElementById('cfg-ie1') || { value: '' }).value || s.ie);
  return Object.assign({}, s, { nome, fant, cnpj14, ie });
}

/** Dados fixos do destinatário para emissão em homologação (sem valor fiscal). */


function homologDest() {
  return {
    nome_destinatario: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
    cpf_destinatario: '51966818092',
    telefone_destinatario: '85999999999',
    logradouro_destinatario: 'Rua Seis Companheiros',
    numero_destinatario: '104',
    bairro_destinatario: 'Barra do Ceará',
    municipio_destinatario: 'Fortaleza',
    uf_destinatario: 'CE',
    pais_destinatario: 'Brasil',
    cep_destinatario: '60331790',
  };
}

/** Lê os dados do destinatário diretamente do formulário (usado apenas em produção). */
function prodDestFromForm() {
  return {
    nome_destinatario: (document.getElementById('v-dest-nome') || { value: '' }).value.trim() || 'CONSUMIDOR FINAL',
    cpf_destinatario: digits((document.getElementById('v-dest-cpf') || { value: '' }).value),
    cnpj_destinatario: digits((document.getElementById('v-dest-cnpj') || { value: '' }).value),
    telefone_destinatario: digits((document.getElementById('v-dest-fone') || { value: '' }).value),
    logradouro_destinatario: (document.getElementById('v-dest-logr') || { value: '' }).value.trim(),
    numero_destinatario: (document.getElementById('v-dest-num') || { value: '' }).value.trim() || 'S/N',
    bairro_destinatario: (document.getElementById('v-dest-bai') || { value: '' }).value.trim(),
    municipio_destinatario: (document.getElementById('v-dest-mun') || { value: '' }).value.trim(),
    uf_destinatario: ((document.getElementById('v-dest-uf') || { value: '' }).value || '').trim().toUpperCase().slice(0, 2),
    pais_destinatario: 'Brasil',
    cep_destinatario: digits((document.getElementById('v-dest-cep') || { value: '' }).value),
  };
}

/**
 * Preenche os campos de endereço do destinatário com os dados do responsável
 * vinculado à venda, quando o ambiente for produção.
 */
function syncDestFromResp() {
  var resp = DB.vendaResp;
  var a = DB.alunos.find(function (x) { return x.resp === resp; });
  if (!a) return;
  var amb = document.getElementById('cfg-amb');
  if (!amb || amb.value !== 'prod') return;

  var map = [
    ['v-dest-nome', a.resp],
    ['v-dest-cpf', digits(a.cpf)],
    ['v-dest-fone', digits(a.fone)],
  ];
  for (var i = 0; i < map.length; i++) {
    var el = document.getElementById(map[i][0]);
    if (el) el.value = map[i][1];
  }
}


/* =============================================================================
   5. API FOCUS — Requisições HTTP e Polling
   Camada de comunicação com a Focus NF.
============================================================================= */

/**
 * Executa uma requisição autenticada para a API Focus NF.
 * @param {string} method  Verbo HTTP (GET, POST, DELETE…)
 * @param {string} path    Caminho da API (ex: /v2/nfe?ref=…)
 * @param {*}      body    Corpo JSON ou null para GET/DELETE sem corpo
 * @returns {{ res: Response, j: object }}
 */
async function focusJson(method, path, body) {
  var headers = Object.assign({ Accept: 'application/json' }, focusAuthHeader());

  /* Informa ao proxy qual ambiente usar */
  var amb = (document.getElementById('cfg-amb') || { value: 'hom' }).value;
  headers['X-Focus-Env'] = amb === 'prod' ? 'prod' : 'hom';

  if (body !== undefined && body !== null)
    headers['Content-Type'] = 'application/json';

  var init = { method, headers };
  if (body !== undefined && body !== null)
    init.body = typeof body === 'string' ? body : JSON.stringify(body);

  var res = await fetch(buildFocusUrl(path), init);
  var t = await res.text();
  var j = {};
  try { j = JSON.parse(t); } catch (_) { j = { _raw: t }; }
  return { res, j };
}

/**
 * Normaliza o campo `status` retornado pela Focus NF para os valores
 * usados internamente: Autorizada | Cancelada | Rejeitada | Processando | (original).
 */
function mapApiStatus(st) {
  var k = String(st || '').toLowerCase().replace(/-/g, '_');
  if (k === 'autorizada') return 'Autorizada';
  if (k === 'cancelada') return 'Cancelada';
  if (k === 'denegada' || k === 'erro_autorizacao' || k === 'rejeitada') return 'Rejeitada';
  if (k === 'processando_autorizacao') return 'Processando';
  return st ? String(st) : 'Desconhecido';
}

/**
 * Aguarda a autorização (ou rejeição) de uma NF-e na SEFAZ por polling.
 * @param {string} ref  Referência da nota na Focus NF
 * @param {number} max  Número máximo de tentativas
 * @param {number} t0   Intervalo em ms entre tentativas
 */
async function pollNfe(ref, max, t0) {
  for (var i = 0; i < max; i++) {
    var r = await focusJson('GET', '/v2/nfe/' + encodeURIComponent(ref) + '?completa=1', null);
    if (!r.res.ok) return r.j;
    var st = String(r.j.status || '').toLowerCase();
    if (st && st !== 'processando_autorizacao') return r.j;
    await sleep(t0);
  }
  return { status: 'timeout', mensagem: 'Tempo esgotado aguardando SEFAZ.' };
}

/** Mesmo comportamento de pollNfe, mas para NF-Ce. */
async function pollNfce(ref, max, t0) {
  for (var i = 0; i < max; i++) {
    var r = await focusJson('GET', '/v2/nfce/' + encodeURIComponent(ref) + '?completa=1', null);
    if (!r.res.ok) return r.j;
    var st = String(r.j.status || '').toLowerCase();
    if (st && st !== 'processando_autorizacao') return r.j;
    await sleep(t0);
  }
  return { status: 'timeout', mensagem: 'Tempo esgotado aguardando SEFAZ.' };
}


/* =============================================================================
   6. DASHBOARD
   Exibe indicadores da sede ativa: NFs emitidas, valor total, alunos e alertas.
============================================================================= */

/** Atualiza todos os indicadores e listas do dashboard para a sede ativa. */
function updDash() {
  var s = DB.sedeAtiva;
  var nfSede = DB.notas.filter(n => n.sedeId === s);

  document.getElementById('d-nf').textContent = nfSede.length;
  document.getElementById('d-val').textContent = fmt(nfSede.reduce((t, n) => t + n.vNF, 0));
  document.getElementById('d-alunos').textContent = DB.alunos.filter(a => a.sede === s).length;

  var crit = DB.livros.filter(l => (l.estoque[s] || 0) <= l.estMin);
  document.getElementById('d-alerta').textContent = crit.length;

  /* Rótulo da sede no cabeçalho do dashboard */
  var nomes = { 1: 'Unidade 1', 2: 'Unidade 2', 3: 'Unidade 3' };
  var sLabel = document.getElementById('d-sede-label');
  if (sLabel) sLabel.textContent = nomes[s];

  /* Últimas 4 notas da sede */
  var dul = document.getElementById('d-ultimas');
  if (!nfSede.length) {
    dul.innerHTML = '<div class="empty">Nenhuma NF emitida nesta sede</div>';
  } else {
    dul.innerHTML = nfSede.slice(-4).reverse().map(n =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--color-border-tertiary)">' +
      '<div>' +
      '<div style="font-size:13px;font-weight:500">' + n.dest.nome + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-tertiary)">NF-e nº ' + n.numero + ' · ' + n.pgto + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:500;color:#0F6E56">' + fmt(n.vNF) + '</div>' +
      '</div>'
    ).join('');
  }

  /* Livros com estoque crítico */
  var dec = document.getElementById('d-estq-crit');
  if (!crit.length) {
    dec.innerHTML = '<div class="empty"><i class="ti ti-check" style="font-size:20px;display:block;margin-bottom:6px;color:#0F6E56" aria-hidden="true"></i>Nenhum alerta</div>';
  } else {
    dec.innerHTML = crit.map(l =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--color-border-tertiary)">' +
      '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">' + l.nome + '</div>' +
      '<span class="badge br">' + (l.estoque[s] || 0) + ' un</span>' +
      '</div>'
    ).join('');
  }
}

/** Atualiza o subtítulo do dashboard ao mudar a sede no seletor global. */
function changeSede() {
  DB.sedeAtiva = parseInt(document.getElementById('sede-global').value);
  var nomes = { 1: 'Unidade 1 — Escola Teste', 2: 'Unidade 2 — Escola Teste', 3: 'Unidade 3 — Escola Teste' };
  var sub = document.getElementById('dash-sede-sub');
  if (sub) sub.textContent = nomes[DB.sedeAtiva];
  updDash();
}


/* =============================================================================
   7. VENDA / NF-e
   Fluxo completo: selecionar responsável → aplicar kit → montar itens →
   calcular totais → transmitir para SEFAZ via Focus NF.
============================================================================= */

/** Popula os <select> de livros, responsáveis e outros combos do sistema. */
function syncSelects() {
  var lopts = '<option value="">Selecione...</option>' +
    DB.livros.map(l => '<option value="' + l.id + '">' + l.nome.substring(0, 40) + '... (' + l.sku + ')</option>').join('');

  ['v-livro', 'e-livro', 'k-livro'].forEach(id => {
    var el = document.getElementById(id);
    if (el) el.innerHTML = lopts;
  });

  /* Responsáveis únicos dos alunos cadastrados */
  var el = document.getElementById('v-resp');
  if (el) {
    var resps = [...new Set(DB.alunos.map(a => a.resp))];
    el.innerHTML = '<option value="">Selecione o responsável...</option>' +
      resps.map(r => '<option value="' + r + '">' + r + '</option>').join('');
  }

  updateEmptyBanner();
}

/**
 * Ao selecionar um responsável, lista os alunos vinculados e
 * oferece o botão "Aplicar Kit" para cada um.
 */
function selecionarResp() {
  var resp = document.getElementById('v-resp').value;
  DB.vendaResp = resp;

  var box = document.getElementById('v-matriculas-box');
  var listEl = document.getElementById('v-matriculas');

  if (!resp) { box.style.display = 'none'; syncDestFromResp(); return; }

  var alunos = DB.alunos.filter(a => a.resp === resp);
  box.style.display = 'block';
  listEl.innerHTML = alunos.map(a =>
    '<div style="padding:8px;border:0.5px solid var(--color-border-tertiary);border-radius:7px;margin-bottom:6px;background:var(--color-background-secondary)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div>' +
    '<div style="font-size:13px;font-weight:500">' + a.nome + '</div>' +
    '<div style="font-size:12px;color:var(--color-text-tertiary)">' + a.serie + ' · Unidade ' + a.sede + '</div>' +
    '</div>' +
    '<button class="btn btn-p btn-sm" onclick="aplicarKit(' + a.id + ')"><i class="ti ti-sparkles" aria-hidden="true"></i> Aplicar Kit</button>' +
    '</div>' +
    '</div>'
  ).join('');

  syncDestFromResp();
}

/**
 * Detecta a série do aluno e aplica automaticamente o kit correspondente
 * à lista de itens da venda.
 */
function aplicarKit(alunoId) {
  var aluno = DB.alunos.find(a => a.id === alunoId);
  if (!aluno) return;

  /* Seleciona o kit baseado na série do aluno */
  var kit = null;
  if (aluno.serie.includes('1º ano EM') || aluno.serie.includes('2º ano EM') || aluno.serie.includes('3º ano EM'))
    kit = DB.kits.find(k => k.num === 3 && k.ativo);
  else if (aluno.serie.includes('6º') || aluno.serie.includes('7º') || aluno.serie.includes('8º') || aluno.serie.includes('9º'))
    kit = DB.kits.find(k => k.num === 2 && k.ativo);
  else
    kit = DB.kits.find(k => k.num === 1 && k.ativo);

  if (!kit) { notif2('Nenhum kit configurado para esta série', 'a'); return; }

  /* Preenche o carrinho com os livros do kit */
  DB.vendaItens = kit.livros.map(i => {
    var l = gl(i.id);
    return { id: l.id, nome: l.nome, sku: l.sku, ncm: l.ncm, cfop: l.cfop, cst: l.cst, un: 'UN', qtd: i.qtd, preco: i.preco };
  });

  document.getElementById('v-kit-sugestao').innerHTML =
    '<div class="badge bb" style="margin-bottom:6px"><i class="ti ti-sparkles" aria-hidden="true"></i> ' +
    kit.nome + ' (' + kit.ano + ') aplicado automaticamente · ' + kit.livros.length + ' livro(s)</div>';

  document.getElementById('v-obs').value =
    'Kit de livros didáticos — ' + aluno.serie + ' — Aluno: ' + aluno.nome;

  renderVendaItens();
  calcVenda();
}

/** Adiciona um livro avulso ao carrinho de venda, verificando o estoque da sede ativa. */
function addItemVenda() {
  var lid = document.getElementById('v-livro').value;
  var qtd = parseInt(document.getElementById('v-qtd').value) || 1;
  var preco = parseFloat(document.getElementById('v-preco').value) || 0;
  var l = gl(lid);

  if (!l) { notif2('Selecione um livro', 'e'); return; }

  var est = l.estoque[DB.sedeAtiva] || 0;
  if (qtd > est) { notif2('Estoque insuficiente na sede! Disponível: ' + est, 'e'); return; }

  /* Agrupa por livro se já estiver no carrinho */
  var ex = DB.vendaItens.find(i => i.id == lid);
  if (ex) ex.qtd += qtd;
  else DB.vendaItens.push({ id: l.id, nome: l.nome, sku: l.sku, ncm: l.ncm, cfop: l.cfop, cst: l.cst, un: 'UN', qtd, preco: preco || l.preco });

  renderVendaItens();
  calcVenda();
}

/** Renderiza a lista de itens do carrinho de venda no DOM. */
function renderVendaItens() {
  var el = document.getElementById('v-itens-list');
  if (!DB.vendaItens.length) { el.innerHTML = '<div class="empty" style="padding:12px">Nenhum item</div>'; return; }
  el.innerHTML = DB.vendaItens.map((it, i) =>
    '<div class="pi">' +
    '<div class="pi-ico"><i class="ti ti-book-2" aria-hidden="true"></i></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + it.nome + '</div>' +
    '<div style="font-size:11px;color:var(--color-text-tertiary)">' + it.qtd + ' x ' + fmt(it.preco) + '</div>' +
    '</div>' +
    '<div style="font-size:13px;font-weight:500;color:#0F6E56;white-space:nowrap">' + fmt(it.qtd * it.preco) + '</div>' +
    '<div class="rm" onclick="DB.vendaItens.splice(' + i + ',1);renderVendaItens();calcVenda()"><i class="ti ti-x" aria-hidden="true"></i></div>' +
    '</div>'
  ).join('');
}

/** Recalcula e exibe subtotal, tributos estimados e total com desconto. */
function calcVenda() {
  var sub = DB.vendaItens.reduce((s, i) => s + i.qtd * i.preco, 0);
  var desc = parseFloat(document.getElementById('v-desc').value) || 0;
  var tot = sub * (1 - desc / 100);
  var trib = tot * 0.3345; /* ~33,45% de carga tributária estimada (IBPT) */

  document.getElementById('v-sub').textContent = fmt(sub);
  document.getElementById('v-trib').textContent = fmt(trib);
  document.getElementById('v-tot').textContent = fmt(tot);
}

/** Bloqueia o botão Transmitir quando não há livros cadastrados no DB. */
function updateVendaGuard() {
  var btn = document.getElementById('btn-transmitir');
  if (!btn) return;
  var bad = !DB.livros.length;
  btn.disabled = bad;
  btn.style.opacity = bad ? 0.55 : 1;
  btn.title = bad ? 'Cadastre pelo menos um livro em Livros / Produtos' : '';
}

/** Limpa o carrinho de venda e reseta os campos do formulário. */
function limparVenda() {
  DB.vendaItens = [];
  DB.vendaResp = null;
  renderVendaItens();
  calcVenda();
  document.getElementById('v-kit-sugestao').innerHTML = '';
  document.getElementById('v-resp').value = '';
  updateVendaGuard();
}

/**
 * Monta o payload JSON no formato exigido pela Focus NF para emissão de NF-e.
 * Em homologação usa destinatário padrão; em produção lê o formulário.
 * @throws {Error} Se em produção faltar CPF/CNPJ ou endereço do destinatário.
 */
function buildNfePayload(sedeId, natText, itens, tot, sub) {
  var emit = readEmitApi(sedeId);
  var amb = (document.getElementById('cfg-amb') || { value: 'hom' }).value;
  var dest;

  if (amb === 'hom') {
    dest = homologDest();
  } else {
    dest = prodDestFromForm();
    if (!dest.cpf_destinatario && !dest.cnpj_destinatario)
      throw new Error('Em produção informe CPF ou CNPJ do destinatário.');
    if (!dest.logradouro_destinatario || !dest.municipio_destinatario || !dest.cep_destinatario)
      throw new Error('Em produção preencha endereço completo do destinatário.');
  }

  var items = itens.map(function (it, idx) {
    return {
      numero_item: String(idx + 1),
      codigo_produto: String(it.sku || it.id).slice(0, 60),
      descricao: String(it.nome).slice(0, 120),
      cfop: String(it.cfop || '5102'),
      unidade_comercial: 'UN',
      quantidade_comercial: String(it.qtd),
      valor_unitario_comercial: dec2(it.preco),
      valor_unitario_tributavel: dec2(it.preco),
      unidade_tributavel: 'UN',
      codigo_ncm: digits(it.ncm || '49019900'),
      quantidade_tributavel: String(it.qtd),
      valor_bruto: dec2(it.qtd * it.preco),
      icms_situacao_tributaria: String(it.cst || '102'),
      icms_origem: '0',
      pis_situacao_tributaria: '07',
      cofins_situacao_tributaria: '07',
    };
  });

  var now = new Date();
  return Object.assign({
    natureza_operacao: natText,
    data_emissao: isoLocal(now),
    data_entrada_saida: isoLocal(now),
    tipo_documento: '1',
    finalidade_emissao: '1',
    cnpj_emitente: emit.cnpj14,
    nome_emitente: emit.nome,
    nome_fantasia_emitente: emit.fant,
    logradouro_emitente: emit.logradouro_emitente,
    numero_emitente: emit.numero_emitente,
    bairro_emitente: emit.bairro_emitente,
    municipio_emitente: emit.municipio_emitente,
    uf_emitente: emit.uf_emitente,
    cep_emitente: digits(emit.cep_emitente),
    inscricao_estadual_emitente: emit.ie,
    valor_frete: '0.00',
    valor_seguro: '0.00',
    valor_total: dec2(tot),
    valor_produtos: dec2(sub),
    modalidade_frete: '0',
    items,
  }, dest);
}

/**
 * Converte a resposta da API Focus NF em um objeto de nota interno (DB.notas).
 * Extrai número, chave, protocolo, status e URLs de DANFE/XML.
 */
function mapFocusToNf(api, ref, sedeId, emitUi, itens, tot, trib, sub, descVal, nat, pgto, obs) {
  var st = mapApiStatus(api.status);
  var dh = new Date();
  if (api.data_emissao) try { dh = new Date(String(api.data_emissao).replace(' ', 'T')); } catch (_) { }

  var destNome = homologDest().nome_destinatario;
  if ((document.getElementById('cfg-amb') || {}).value === 'prod')
    destNome = (document.getElementById('v-dest-nome') || { value: '' }).value.trim() || 'CONSUMIDOR FINAL';

  var resp = DB.alunos.find(function (a) { return a.resp === DB.vendaResp; });
  if (resp && destNome.indexOf('HOMOLOGACAO') === -1) destNome = resp.resp || destNome;

  /* Formata o CEP como XXXXX-XXX */
  var cepDisp = emitUi.cep_emitente || '';
  if (cepDisp && cepDisp.length === 8) cepDisp = cepDisp.slice(0, 5) + '-' + cepDisp.slice(5);

  return {
    apiRef: ref,
    numero: String(api.numero || api.numero_nfe || ''),
    chave: String(api.chave_nfe || api.chave_acesso || ''),
    nProt: String(api.protocolo || api.numero_protocolo || ''),
    serie: String(api.serie || '1'),
    sedeId,
    emit: {
      nome: emitUi.nome,
      fant: emitUi.fant,
      cnpj: emitUi.cnpj || emitUi.cnpj14,
      ie: emitUi.ie,
      end: (emitUi.logradouro_emitente || '') + ', ' + (emitUi.numero_emitente || ''),
      bairro: emitUi.bairro_emitente,
      cidade: emitUi.municipio_emitente,
      uf: emitUi.uf_emitente,
      cep: cepDisp,
    },
    dest: {
      nome: destNome,
      cpf: resp ? resp.cpf : '',
      email: resp ? resp.email : '',
      fone: resp ? resp.fone : '',
      rua: '',
      cidade: '',
      cep: '',
    },
    nat, pgto, obs,
    itens: itens.map(function (x) { return Object.assign({}, x); }),
    vProd: tot,
    vNF: tot,
    vTrib: trib,
    vDesc: descVal,
    dhEmi: dh,
    status: st,
    xMotivo: String(api.mensagem_sefaz || api.mensagem || api.descricao_status || ''),
    danfe: String(api.caminho_danfe || api.url_danfe || ''),
    xml: String(api.caminho_xml_nota_fiscal || api.url_xml || ''),
    fromApi: true,
  };
}

/**
 * Transmite a NF-e para a SEFAZ via Focus NF.
 * Faz polling até a autorização, salva no DB e decrementa o estoque.
 */
async function emitirNF() {
  if (!DB.livros.length) { notif2('Cadastre pelo menos um livro em Livros / Produtos.', 'e'); go('livros'); return; }
  if (!DB.vendaItens.length) { notif2('Adicione itens antes de transmitir', 'e'); return; }

  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  var sub = DB.vendaItens.reduce((s, i) => s + i.qtd * i.preco, 0);
  var desc = parseFloat(document.getElementById('v-desc').value) || 0;
  var tot = sub * (1 - desc / 100);
  var trib = tot * 0.3345;
  var sedeId = parseInt(document.getElementById('v-sede').value);
  var nat = document.getElementById('v-nat').options[document.getElementById('v-nat').selectedIndex].text.split(' (')[0];
  var pgto = document.getElementById('v-pgto').value;
  var obs = document.getElementById('v-obs').value;
  var ref = 'escola-teste-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  var payload;
  try { payload = buildNfePayload(sedeId, nat, DB.vendaItens.map(i => ({ ...i })), tot, sub); }
  catch (err) { notif2(String(err.message || err), 'e'); return; }

  try {
    var post = await focusJson('POST', '/v2/nfe?ref=' + encodeURIComponent(ref), payload);
    if (!post.res.ok) { notif2(esc(post.j.mensagem || post.j.message || ('HTTP ' + post.res.status)), 'e'); return; }

    var j = post.j;
    /* Aguarda autorização se a SEFAZ ainda estiver processando */
    if (String(j.status || '').toLowerCase() === 'processando_autorizacao')
      j = await pollNfe(ref, 25, 700) || j;

    var st = mapApiStatus(j.status);
    if (st !== 'Autorizada') { notif2(esc(j.mensagem_sefaz || j.mensagem || j.descricao_status || 'Nota não autorizada'), 'e'); return; }

    var nf = mapFocusToNf(j, ref, sedeId, readEmitApi(sedeId), DB.vendaItens.map(i => ({ ...i })), tot, trib, sub, sub - tot, nat, pgto, obs);
    DB.notas.push(nf);

    /* Debita o estoque da sede */
    DB.vendaItens.forEach(it => {
      var l = gl(it.id);
      if (l) l.estoque[sedeId] = Math.max(0, (l.estoque[sedeId] || 0) - it.qtd);
    });

    limparVenda();
    updDash();
    saveDb();
    notif2('NF-e transmitida. Nº ' + esc(nf.numero), '');
    setTimeout(function () { mostrarNF(nf); }, 400);

  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    if (msg.indexOf('Failed to fetch') >= 0)
      notif2('Rede: arranque o servidor (npm start) na pasta do projeto ou defina URL de proxy.', 'a');
    else
      notif2(msg, 'e');
  }
}

/** Abre o XML da nota em uma nova aba (URL retornada pela Focus NF). */
function openNfXml() {
  var n = window.__nfPreview;
  if (n && n.xml) window.open(n.xml, '_blank');
  else notif2('XML indisponível nesta pré-visualização.', 'a');
}

/** Abre o DANFE da nota em uma nova aba (URL retornada pela Focus NF). */
function openNfDanfe() {
  var n = window.__nfPreview;
  if (n && n.danfe) window.open(n.danfe, '_blank');
  else notif2('DANFE indisponível — consulte na Focus.', 'a');
}

/** Renderiza a pré-visualização de uma NF-e no painel de histórico. */
function mostrarNF(nf) {
  window.__nfPreview = nf; /* Guarda referência para openNfXml / openNfDanfe */

  var dh = nf.dhEmi.toLocaleDateString('pt-BR') + ' ' + nf.dhEmi.toLocaleTimeString('pt-BR');
  var itensHTML = nf.itens.map((it, i) =>
    '<tr>' +
    '<td style="width:30px">' + (i + 1) + '</td>' +
    '<td style="width:130px;font-size:11px">' + esc(it.sku) + '</td>' +
    '<td>' + esc(it.nome) + '</td>' +
    '<td style="width:80px">' + esc(it.ncm) + '</td>' +
    '<td style="width:45px">' + it.qtd.toFixed(3) + '</td>' +
    '<td style="width:30px">UN</td>' +
    '<td style="width:80px">R$ ' + R(it.preco) + '</td>' +
    '<td style="width:80px">R$ ' + R(it.qtd * it.preco) + '</td>' +
    '</tr>'
  ).join('');

  var html =
    '<div class="nf-bg">' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
    '<button type="button" class="btn btn-p btn-sm" onclick="window.print()"><i class="ti ti-printer" aria-hidden="true"></i> Imprimir</button>' +
    '<button type="button" class="btn btn-sm" onclick="openNfDanfe()"><i class="ti ti-external-link" aria-hidden="true"></i> DANFE (Focus)</button>' +
    '<button type="button" class="btn btn-sm" onclick="openNfXml()"><i class="ti ti-download" aria-hidden="true"></i> XML (Focus)</button>' +
    '<span class="badge bg" style="align-self:center"><i class="ti ti-check" aria-hidden="true"></i> ' + esc(nf.status) + '</span>' +
    '</div>' +
    '<div class="nf-doc">' +
    '<header class="nf-header">' +
    '<div><h1 class="nf-h1">' + esc(nf.emit.nome) + '</h1><div class="nf-h-small">' + esc(nf.emit.fant) + '</div></div>' +
    '<div class="nf-hr">' +
    '<div><span class="nf-lbl">Natureza da Operação</span>' + esc(nf.nat) + '</div>' +
    '<div style="margin-top:6px"><span class="nf-lbl">Nº da Nota / Série</span>' + esc(nf.numero) + ' / ' + esc(nf.serie || '1') + '</div>' +
    '<div style="margin-top:4px"><span class="nf-lbl">Emissão</span>' + esc(dh) + '</div>' +
    '</div>' +
    '</header>' +

    /* Emitente */
    '<div class="nf-sec"><div class="nf-sec-title">Emitente</div><div class="nf-grid">' +
    '<div class="nf-field"><span class="nf-lbl">CNPJ</span>' + esc(nf.emit.cnpj) + '</div>' +
    '<div class="nf-field"><span class="nf-lbl">Inscrição Estadual</span>' + esc(nf.emit.ie) + '</div>' +
    '<div class="nf-field"><span class="nf-lbl">Endereço</span>' + esc(nf.emit.end) + ' - ' + esc(nf.emit.bairro) + '</div>' +
    '<div class="nf-field"><span class="nf-lbl">Cidade/UF</span>' + esc(nf.emit.cidade) + ' / ' + esc(nf.emit.uf) + ' — CEP: ' + esc(nf.emit.cep) + '</div>' +
    '</div></div>' +

    /* Destinatário */
    '<div class="nf-sec"><div class="nf-sec-title">Destinatário</div><div class="nf-grid">' +
    '<div class="nf-field"><span class="nf-lbl">Nome / Razão Social</span>' + esc(nf.dest.nome) + '</div>' +
    '<div class="nf-field"><span class="nf-lbl">CPF / CNPJ</span>' + esc(nf.dest.cpf || '—') + '</div>' +
    (nf.dest.email ? '<div class="nf-field"><span class="nf-lbl">E-mail</span>' + esc(nf.dest.email) + '</div>' : '') +
    (nf.dest.fone ? '<div class="nf-field"><span class="nf-lbl">Telefone</span>' + esc(nf.dest.fone) + '</div>' : '') +
    '</div></div>' +

    /* Itens */
    '<div class="nf-sec"><div class="nf-sec-title">Itens da Nota</div>' +
    '<table class="nf-table"><thead><tr><th>Item</th><th>Cód.</th><th>Descrição</th><th>NCM</th><th>Qtd</th><th>Un</th><th>Vlr Unit.</th><th>Total</th></tr></thead>' +
    '<tbody>' + itensHTML + '</tbody></table>' +
    '</div>' +

    /* Totais */
    '<div class="nf-sec"><div class="nf-sec-title">Pagamento e Totais</div><div class="nf-grid">' +
    '<div class="nf-field"><span class="nf-lbl">Modalidade de Pagamento</span>' + esc(nf.pgto) + '</div><div></div>' +
    '</div><div class="nf-totbox">VALOR TOTAL: R$ ' + R(nf.vNF) + '</div></div>' +

    /* Protocolo */
    '<div class="nf-proto"><strong>Chave de Acesso:</strong> ' + esc(nf.chave) +
    '<br><strong>Protocolo:</strong> ' + esc(nf.nProt) + ' &nbsp;·&nbsp; <strong>Status:</strong> ' + esc(nf.xMotivo) + '</div>' +

    /* Rodapé */
    '<div class="nf-footer">' +
    (nf.obs ? '<strong>Informações Adicionais:</strong> ' + esc(nf.obs) + '<br>' : '') +
    'Val. Aprox. Tributos: R$ ' + R(nf.vTrib) + ' · Fonte: IBPT<br>' +
    'Pré-visualização local — documento fiscal válido conforme retorno da Focus NF.' +
    '</div>' +
    '</div>' +
    '</div>';

  go('hist');
  setTimeout(function () {
    document.getElementById('nf-viewer').innerHTML = html;
    renderHist(DB.notas);
  }, 80);
}


/* =============================================================================
   8. NF-Ce (Fardamento)
   Emissão de Nota Fiscal de Consumidor Eletrônica para venda de roupas/calçados.
============================================================================= */

/** Popula o <select> de produtos de fardamento na aba NF-Ce. */
function syncNfceProdSelect() {
  var el = document.getElementById('nfce-prod');
  if (!el) return;
  el.innerHTML = '<option value="">Selecione...</option>' +
    DB.fardamento.map(function (f) {
      return '<option value="' + f.id + '">' + esc(f.nome) + ' (' + f.sku + ') — ' + fmt(f.preco) + '</option>';
    }).join('');
}

/** Adiciona um item de fardamento ao carrinho NF-Ce, verificando o estoque da sede. */
function addItemNfce() {
  var fid = document.getElementById('nfce-prod').value;
  var qtd = parseInt(document.getElementById('nfce-qtd').value) || 1;
  var preco = parseFloat(document.getElementById('nfce-preco').value) || 0;
  var f = glFard(fid);
  if (!f) { notif2('Selecione um produto', 'e'); return; }

  var sedeId = parseInt(document.getElementById('nfce-sede').value) || DB.sedeAtiva;
  var est = f.estoque[sedeId] || 0;
  if (qtd > est) { notif2('Estoque insuficiente nesta sede! Disponível: ' + est, 'e'); return; }

  var ex = DB.nfceItens.find(function (i) { return i.id == fid; });
  if (ex) ex.qtd += qtd;
  else DB.nfceItens.push({ id: f.id, nome: f.nome, sku: f.sku, ncm: f.ncm, cfop: f.cfop, cst: f.cst, un: 'UN', qtd, preco: preco || f.preco });

  renderNfceItens();
  calcNfce();
}

/** Renderiza os itens do carrinho NF-Ce no DOM. */
function renderNfceItens() {
  var el = document.getElementById('nfce-itens-list');
  if (!DB.nfceItens.length) { el.innerHTML = '<div class="empty" style="padding:12px">Nenhum item</div>'; return; }
  el.innerHTML = DB.nfceItens.map(function (it, i) {
    return '<div class="pi">' +
      '<div class="pi-ico"><i class="ti ti-shirt" aria-hidden="true"></i></div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.nome) + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-tertiary)">' + it.qtd + ' x ' + fmt(it.preco) + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:500;color:#0F6E56;white-space:nowrap">' + fmt(it.qtd * it.preco) + '</div>' +
      '<div class="rm" onclick="DB.nfceItens.splice(' + i + ',1);renderNfceItens();calcNfce()"><i class="ti ti-x" aria-hidden="true"></i></div>' +
      '</div>';
  }).join('');
}

/** Recalcula subtotal e total com desconto para a NF-Ce. */
function calcNfce() {
  var sub = DB.nfceItens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0);
  var desc = parseFloat(document.getElementById('nfce-desc').value) || 0;
  var tot = sub * (1 - desc / 100);
  document.getElementById('nfce-sub').textContent = fmt(sub);
  document.getElementById('nfce-tot').textContent = fmt(tot);
}

/** Limpa o carrinho NF-Ce e os campos de destinatário. */
function limparNfce() {
  DB.nfceItens = [];
  renderNfceItens();
  calcNfce();
  document.getElementById('nfce-dest-nome').value = '';
  document.getElementById('nfce-dest-cpf').value = '';
  document.getElementById('nfce-dest-email').value = '';
}

/**
 * Monta o payload JSON para emissão de NF-Ce (modelo 65) via Focus NF.
 * Em homologação usa CPF/endereço fixo; em produção usa os dados informados.
 */
function buildNfcePayload(sedeId, itens, tot, sub, pgtoCode, obs, destNome, destCpf) {
  var emit = readEmitApi(sedeId);

  var items = itens.map(function (it, idx) {
    return {
      numero_item: String(idx + 1),
      codigo_produto: String(it.sku || it.id).slice(0, 60),
      descricao: String(it.nome).slice(0, 120),
      cfop: String(it.cfop || '5102'),
      unidade_comercial: 'UN',
      quantidade_comercial: String(it.qtd),
      valor_unitario_comercial: dec2(it.preco),
      valor_unitario_tributavel: dec2(it.preco),
      unidade_tributavel: 'UN',
      codigo_ncm: digits(it.ncm || '61051000'),
      quantidade_tributavel: String(it.qtd),
      valor_bruto: dec2(it.qtd * it.preco),
      icms_origem: '0',
      icms_situacao_tributaria: '40',
      icms_modalidade_base_calculo: '3',
      icms_aliquota: '00.00',
      // icms_base_calculo: dec2(it.qtd * it.preco),
      icms_base_calculo: '0.00',
      // pis_situacao_tributaria: '07',
      // cofins_situacao_tributaria: '07',
    };
  });

  var now = new Date();
  var payload = {
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    data_emissao: isoLocal(now) + '-03:00',
    tipo_documento: '1',
    presenca_comprador: '1',
    consumidor_final: '1',
    finalidade_emissao: '1',
    cnpj_emitente: emit.cnpj14,
    inscricao_estadual_emitente: emit.ie,
    informacoes_adicionais_contribuinte: obs || 'RETIRADA POR CONTA DO DESTINATÁRIO',
    valor_produtos: dec2(sub),
    valor_desconto: dec2(sub - tot),
    valor_total: dec2(tot),
    forma_pagamento: pgtoCode,
    icms_valor_total: '0',
    modalidade_frete: '9',
    local_destino: '1',
    items,
    formas_pagamento: [{ forma_pagamento: pgtoCode, valor_pagamento: dec2(tot) }],
  };

  var amb = (document.getElementById('cfg-amb') || { value: 'hom' }).value;

  if (amb === 'hom') {
    /* Dados fixos obrigatórios para homologação */
    payload.nome_destinatario = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
    payload.cpf_destinatario = '06555211350';
    payload.logradouro_destinatario = 'Rua São Januário';
    payload.numero_destinatario = '99';
    payload.bairro_destinatario = 'Crespo';
    payload.municipio_destinatario = 'FORTALEZA';
    payload.uf_destinatario = 'CE';

  } else {
    if (destNome) payload.nome_destinatario = destNome;
    if (destCpf) payload.cpf_destinatario = destCpf;
  }

  return payload;
}

/**
 * Transmite a NF-Ce para a SEFAZ via Focus NF.
 * Fluxo idêntico ao da NF-e: POST → polling → autorização → débito de estoque.
 */
async function emitirNFCe() {
  if (!DB.nfceItens.length) { notif2('Adicione itens antes de transmitir', 'e'); return; }

  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  var sub = DB.nfceItens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0);
  var desc = parseFloat(document.getElementById('nfce-desc').value) || 0;
  var tot = sub * (1 - desc / 100);
  var sedeId = parseInt(document.getElementById('nfce-sede').value);
  var pgtoCode = document.getElementById('nfce-pgto').value;
  var pgtoLabel = document.getElementById('nfce-pgto').options[document.getElementById('nfce-pgto').selectedIndex].text;
  var obs = document.getElementById('nfce-obs').value;
  var destNome = (document.getElementById('nfce-dest-nome').value || '').trim() || 'CONSUMIDOR FINAL';
  var destCpf = digits(document.getElementById('nfce-dest-cpf').value || '');
  var destEmail = (document.getElementById('nfce-dest-email').value || '').trim();
  var ref = 'escola-teste-nfce-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  var payload;
  try { payload = buildNfcePayload(sedeId, DB.nfceItens.map(function (i) { return Object.assign({}, i); }), tot, sub, pgtoCode, obs, destNome, destCpf); }
  catch (err) { notif2(String(err.message || err), 'e'); return; }

  try {
    var post = await focusJson('POST', '/v2/nfce?ref=' + encodeURIComponent(ref), payload);
    if (!post.res.ok) { notif2(esc(post.j.mensagem || post.j.message || ('HTTP ' + post.res.status)), 'e'); return; }

    var j = post.j;
    if (String(j.status || '').toLowerCase() === 'processando_autorizacao')
      j = await pollNfce(ref, 25, 700) || j;

    var st = mapApiStatus(j.status);
    if (st !== 'Autorizada') { notif2(esc(j.mensagem_sefaz || j.mensagem || j.descricao_status || 'NF-Ce não autorizada'), 'e'); return; }

    var emit = readEmitApi(sedeId);
    var nfce = {
      apiRef: ref,
      numero: String(j.numero || j.numero_nfe || ''),
      chave: String(j.chave_nfe || j.chave_acesso || ''),
      nProt: String(j.protocolo || j.numero_protocolo || ''),
      serie: String(j.serie || '1'),
      sedeId,
      emit: { nome: emit.nome, fant: emit.fant, cnpj: emit.cnpj || emit.cnpj14, ie: emit.ie },
      dest: { nome: destNome, cpf: destCpf, email: destEmail },
      pgto: pgtoLabel,
      obs,
      itens: DB.nfceItens.map(function (i) { return Object.assign({}, i); }),
      vProd: sub,
      vNF: tot,
      vDesc: sub - tot,
      dhEmi: new Date(),
      status: st,
      xMotivo: String(j.mensagem_sefaz || j.mensagem || ''),
      danfe: String(j.caminho_danfe || j.url_danfe || ''),
      xml: String(j.caminho_xml_nota_fiscal || j.url_xml || ''),
      fromApi: true,
    };

    DB.notasNfce.push(nfce);

    /* Debita o estoque de fardamento da sede */
    DB.nfceItens.forEach(function (it) {
      var f = glFard(it.id);
      if (f) f.estoque[sedeId] = Math.max(0, (f.estoque[sedeId] || 0) - it.qtd);
    });

    DB.nfceCounter++;
    limparNfce();
    saveDb();
    notif2('NF-Ce transmitida. Nº ' + esc(nfce.numero), '');
    renderHistNfce(DB.notasNfce);

  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    if (msg.indexOf('Failed to fetch') >= 0)
      notif2('Rede: arranque o servidor (npm start) na pasta do projeto.', 'a');
    else
      notif2(msg, 'e');
  }
}


/* =============================================================================
   9. HISTÓRICO — NF-e e NF-Ce
   Tabelas com listagem, filtros e pré-visualização das notas emitidas.
============================================================================= */

/** Renderiza a tabela de histórico de NF-e com as ações disponíveis por linha. */
function renderHist(lista) {
  var el = document.getElementById('hist-tbl');
  if (!lista.length) { el.innerHTML = '<div class="empty">Nenhuma NF emitida</div>'; return; }

  var rows = lista.slice().reverse().map(function (n, i) {
    var realIdx = DB.notas.length - 1 - i;
    var acoes = '<button type="button" class="btn btn-sm" title="Visualizar" onclick="mostrarNF(DB.notas[' + realIdx + '])"><i class="ti ti-eye" aria-hidden="true"></i></button>';
    acoes += ' <button type="button" class="btn btn-sm" title="Consultar na SEFAZ" onclick="consultarNFe(' + realIdx + ')"><i class="ti ti-search" aria-hidden="true"></i></button>';
    acoes += ' <button type="button" class="btn btn-sm" title="Enviar por e-mail" onclick="enviarEmailNFe(' + realIdx + ')"><i class="ti ti-mail" aria-hidden="true"></i></button>';
    if (n.status === 'Autorizada')
      acoes += ' <button type="button" class="btn btn-sm" style="color:#A32D2D" title="Cancelar NF-e" onclick="cancelarNF(' + realIdx + ')"><i class="ti ti-ban" aria-hidden="true"></i></button>';

    var badgeClass = n.status === 'Autorizada' ? 'bg' : n.status === 'Cancelada' ? 'br' : 'ba';
    return '<tr style="border-bottom:0.5px solid var(--color-border-tertiary)">' +
      '<td style="padding:8px;font-family:monospace;font-size:11px;color:var(--color-text-primary)">' + n.numero + '</td>' +
      '<td style="padding:8px;color:var(--color-text-primary)">' + n.dhEmi.toLocaleDateString('pt-BR') + '</td>' +
      '<td style="padding:8px;color:var(--color-text-primary)">' + n.dest.nome + '</td>' +
      '<td style="padding:8px"><span class="badge bgr">Unidade ' + n.sedeId + '</span></td>' +
      '<td style="padding:8px;color:var(--color-text-primary)">' + n.pgto + '</td>' +
      '<td style="padding:8px;text-align:right;font-weight:500;color:var(--color-text-primary)">' + fmt(n.vNF) + '</td>' +
      '<td style="padding:8px"><span class="badge ' + badgeClass + '">' + n.status + '</span></td>' +
      '<td style="padding:8px;white-space:nowrap">' + acoes + '</td>' +
      '</tr>';
  });

  el.innerHTML =
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="border-bottom:0.5px solid var(--color-border-tertiary)">' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Nº</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Data</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Destinatário</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Unidade</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Pgto</th>' +
    '<th style="padding:8px;text-align:right;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Total</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Status</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Ações</th>' +
    '</tr></thead>' +
    '<tbody>' + rows.join('') + '</tbody>' +
    '</table></div>';
}

/** Filtra o histórico de NF-e por sede e/ou status. */
function filtrarHist() {
  var sed = document.getElementById('h-sede-fil').value;
  var sta = document.getElementById('h-status-fil').value;
  var lista = DB.notas.filter(n =>
    (sed ? n.sedeId == parseInt(sed) : true) &&
    (sta ? n.status === sta : true)
  );
  renderHist(lista);
}

/** Renderiza a tabela de histórico de NF-Ce. */
function renderHistNfce(lista) {
  var el = document.getElementById('nfce-hist-tbl');
  if (!el) return;
  if (!lista.length) { el.innerHTML = '<div class="empty">Nenhuma NF-Ce emitida</div>'; return; }

  var rows = lista.slice().reverse().map(function (n, i) {
    var realIdx = DB.notasNfce.length - 1 - i;
    var acoes = '<button type="button" class="btn btn-sm" title="Consultar na SEFAZ" onclick="consultarNFCe(' + realIdx + ')"><i class="ti ti-search" aria-hidden="true"></i></button>';
    acoes += ' <button type="button" class="btn btn-sm" title="Enviar por e-mail" onclick="enviarEmailNFCe(' + realIdx + ')"><i class="ti ti-mail" aria-hidden="true"></i></button>';
    if (n.status === 'Autorizada')
      acoes += ' <button type="button" class="btn btn-sm" style="color:#A32D2D" title="Cancelar NF-Ce" onclick="cancelarNFCe(' + realIdx + ')"><i class="ti ti-ban" aria-hidden="true"></i></button>';

    var badgeClass = n.status === 'Autorizada' ? 'bg' : n.status === 'Cancelada' ? 'br' : 'ba';
    return '<tr style="border-bottom:0.5px solid var(--color-border-tertiary)">' +
      '<td style="padding:8px;font-family:monospace;font-size:11px">' + esc(n.numero) + '</td>' +
      '<td style="padding:8px">' + n.dhEmi.toLocaleDateString('pt-BR') + '</td>' +
      '<td style="padding:8px">' + esc(n.dest.nome) + '</td>' +
      '<td style="padding:8px"><span class="badge bgr">Unidade ' + n.sedeId + '</span></td>' +
      '<td style="padding:8px">' + esc(n.pgto) + '</td>' +
      '<td style="padding:8px;text-align:right;font-weight:500;color:var(--color-text-primary)">' + fmt(n.vNF) + '</td>' +
      '<td style="padding:8px"><span class="badge ' + badgeClass + '">' + esc(n.status) + '</span></td>' +
      '<td style="padding:8px;white-space:nowrap">' + acoes + '</td>' +
      '</tr>';
  });

  el.innerHTML =
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="border-bottom:0.5px solid var(--color-border-tertiary)">' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Nº</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Data</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Comprador</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Unidade</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Pgto</th>' +
    '<th style="padding:8px;text-align:right;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Total</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Status</th>' +
    '<th style="padding:8px;text-align:left;color:var(--color-text-tertiary);font-size:11px;font-weight:500">Ações</th>' +
    '</tr></thead>' +
    '<tbody>' + rows.join('') + '</tbody>' +
    '</table></div>';
}

/** Filtra o histórico de NF-Ce por status. */
function filtrarHistNfce() {
  var sta = document.getElementById('nfce-hist-fil').value;
  var lista = DB.notasNfce.filter(function (n) { return sta ? n.status === sta : true; });
  renderHistNfce(lista);
}


/* =============================================================================
   10. CANCELAMENTO
   Envia o pedido de cancelamento para a Focus NF e reverte o estoque local.
============================================================================= */

/** Pede confirmação e inicia o cancelamento assíncrono de uma NF-e. */
function cancelarNF(idx) {
  if (!confirm('Cancelar NF-e ' + DB.notas[idx].numero + '? Reverte o estoque local.')) return;
  cancelarNFAsync(idx);
}

/** Executa o cancelamento da NF-e via API Focus e reverte o estoque. */
async function cancelarNFAsync(idx) {
  var nf = DB.notas[idx];
  var token = getToken();

  if (nf.apiRef && token) {
    var jus = prompt('Justificativa (mínimo 15 caracteres):', 'Erro no cadastro da nota fiscal.');
    if (!jus || String(jus).trim().length < 15) { notif2('Justificativa com pelo menos 15 caracteres.', 'e'); return; }

    try {
      var out = await focusJson('DELETE', '/v2/nfe/' + encodeURIComponent(nf.apiRef), { justificativa: String(jus).trim() });
      if (!out.res.ok) { notif2(esc(out.j.mensagem || out.j.message || ('HTTP ' + out.res.status)), 'e'); return; }
    } catch (e) {
      if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) { notif2('Rede: npm start ou proxy externo.', 'a'); return; }
      notif2(String(e), 'e'); return;
    }
  }

  /* Reverte o estoque independentemente do resultado da API */
  nf.itens.forEach(it => { var l = gl(it.id); if (l) l.estoque[nf.sedeId] = (l.estoque[nf.sedeId] || 0) + it.qtd; });
  nf.status = 'Cancelada';
  nf.xMotivo = 'Cancelamento registrado';
  saveDb();
  renderHist(DB.notas);
  notif2('NF-e cancelada. Estoque revertido.', '');
}

/** Pede confirmação e inicia o cancelamento assíncrono de uma NF-Ce. */
function cancelarNFCe(idx) {
  if (!confirm('Cancelar NF-Ce ' + DB.notasNfce[idx].numero + '? Reverte o estoque local.')) return;
  cancelarNFCeAsync(idx);
}

/** Executa o cancelamento da NF-Ce via API Focus e reverte o estoque de fardamento. */
async function cancelarNFCeAsync(idx) {
  var nf = DB.notasNfce[idx];
  var token = getToken();

  if (nf.apiRef && token) {
    var jus = prompt('Justificativa (mínimo 15 caracteres):', 'Erro no cadastro do cupom fiscal.');
    if (!jus || String(jus).trim().length < 15) { notif2('Justificativa com pelo menos 15 caracteres.', 'e'); return; }

    try {
      /* A Focus NF usa o mesmo endpoint /v2/nfe/ para cancelamento de NF-Ce */
      var out = await focusJson('DELETE', '/v2/nfe/' + encodeURIComponent(nf.apiRef), { justificativa: String(jus).trim() });
      if (!out.res.ok) { notif2(esc(out.j.mensagem || out.j.message || ('HTTP ' + out.res.status)), 'e'); return; }
    } catch (e) {
      if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) { notif2('Rede: npm start ou proxy externo.', 'a'); return; }
      notif2(String(e), 'e'); return;
    }
  }

  nf.itens.forEach(function (it) { var f = glFard(it.id); if (f) f.estoque[nf.sedeId] = (f.estoque[nf.sedeId] || 0) + it.qtd; });
  nf.status = 'Cancelada';
  nf.xMotivo = 'Cancelamento registrado';
  saveDb();
  renderHistNfce(DB.notasNfce);
  notif2('NF-Ce cancelada. Estoque de fardamento revertido.', '');
}


/* =============================================================================
   11. CONSULTA E ENVIO DE E-MAIL
   Reintegra o status SEFAZ e reencaminha DANFE/XML por e-mail via Focus NF.
============================================================================= */

/** Consulta o status atual de uma NF-e diretamente na SEFAZ via Focus NF. */
async function consultarNFe(idx) {
  var nf = DB.notas[idx];
  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  notif2('Consultando na SEFAZ...', '');
  try {
    var r = await focusJson('GET', '/v2/nfe/' + encodeURIComponent(nf.apiRef) + '?completa=1', null);
    if (!r.res.ok) { notif2(esc(r.j.mensagem || r.j.message || ('HTTP ' + r.res.status)), 'e'); return; }

    var st = mapApiStatus(r.j.status);
    DB.notas[idx].status = st;
    DB.notas[idx].xMotivo = String(r.j.mensagem_sefaz || r.j.mensagem || r.j.descricao_status || '');
    saveDb();
    renderHist(DB.notas);
    notif2('Status: ' + st + ' · ' + esc(DB.notas[idx].xMotivo), '');
  } catch (e) {
    if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) notif2('Rede: npm start ou proxy externo.', 'a');
    else notif2(String(e), 'e');
  }
}

/** Solicita endereços e envia o DANFE/XML da NF-e por e-mail via Focus NF. */
async function enviarEmailNFe(idx) {
  var nf = DB.notas[idx];
  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  var dest = nf.dest && nf.dest.email ? nf.dest.email : '';
  var addr = prompt('E-mail(s) para envio (separados por vírgula):', dest || '');
  if (!addr || !addr.trim()) return;

  var emails = addr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  notif2('Enviando e-mail via Focus NF...', '');
  try {
    var r = await focusJson('POST', '/v2/nfe/' + encodeURIComponent(nf.apiRef) + '/email', { emails });
    if (!r.res.ok) { notif2(esc(r.j.mensagem || r.j.message || ('HTTP ' + r.res.status)), 'e'); return; }
    notif2('E-mail(s) enviado(s) com sucesso.', '');
  } catch (e) {
    if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) notif2('Rede: npm start ou proxy externo.', 'a');
    else notif2(String(e), 'e');
  }
}

/** Consulta o status atual de uma NF-Ce diretamente na SEFAZ via Focus NF. */
async function consultarNFCe(idx) {
  var nf = DB.notasNfce[idx];
  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  notif2('Consultando NF-Ce na SEFAZ...', '');
  try {
    var r = await focusJson('GET', '/v2/nfce/' + encodeURIComponent(nf.apiRef) + '?completa=1', null);
    if (!r.res.ok) { notif2(esc(r.j.mensagem || r.j.message || ('HTTP ' + r.res.status)), 'e'); return; }

    var st = mapApiStatus(r.j.status);
    DB.notasNfce[idx].status = st;
    DB.notasNfce[idx].xMotivo = String(r.j.mensagem_sefaz || r.j.mensagem || r.j.descricao_status || '');
    saveDb();
    renderHistNfce(DB.notasNfce);
    notif2('Status: ' + st + ' · ' + esc(DB.notasNfce[idx].xMotivo), '');
  } catch (e) {
    if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) notif2('Rede: npm start ou proxy externo.', 'a');
    else notif2(String(e), 'e');
  }
}

/** Solicita endereços e envia o cupom da NF-Ce por e-mail via Focus NF. */
async function enviarEmailNFCe(idx) {
  var nf = DB.notasNfce[idx];
  var token = getToken();
  if (!token) { notif2('Defina o token em Configurações.', 'e'); go('config'); return; }

  var dest = nf.dest && nf.dest.email ? nf.dest.email : '';
  var addr = prompt('E-mail(s) para envio do cupom (separados por vírgula):', dest || '');
  if (!addr || !addr.trim()) return;

  var emails = addr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  notif2('Enviando e-mail via Focus NF...', '');
  try {
    var r = await focusJson('POST', '/v2/nfce/' + encodeURIComponent(nf.apiRef) + '/email', { emails });
    if (!r.res.ok) { notif2(esc(r.j.mensagem || r.j.message || ('HTTP ' + r.res.status)), 'e'); return; }
    notif2('E-mail(s) enviado(s) com sucesso.', '');
  } catch (e) {
    if (String(e && e.message ? e.message : e).indexOf('Failed to fetch') >= 0) notif2('Rede: npm start ou proxy externo.', 'a');
    else notif2(String(e), 'e');
  }
}


/* =============================================================================
   12. ESTOQUE
   Exibe o nível de estoque por sede com barra de progresso colorida.
============================================================================= */

/** Renderiza o painel de estoque filtrado por sede (ou todas as sedes). */
function renderEstoque() {
  var fil = parseInt(document.getElementById('est-sede-fil').value) || 0;
  var sedes = fil ? [fil] : [1, 2, 3];
  var nomes = { 1: 'Unidade 1 — Escola Teste', 2: 'Unidade 2 — Escola Teste', 3: 'Unidade 3 — Escola Teste' };

  var html = sedes.map(s =>
    '<div class="card"><div class="card-title">' + nomes[s] + '</div>' +
    DB.livros.map(l => {
      var est = l.estoque[s] || 0;
      /* Cor da barra: vermelho (crítico) → amarelo (atenção) → verde (ok) */
      var pct = Math.min(100, (est / Math.max(1, l.estMin * 3)) * 100);
      var cor = est <= l.estMin ? '#E24B4A' : est <= l.estMin * 2 ? '#EF9F27' : '#1D9E75';
      return '<div style="padding:8px 0;border-bottom:0.5px solid var(--color-border-tertiary)">' +
        '<div style="display:flex;justify-content:space-between">' +
        '<div style="min-width:0;flex:1">' +
        '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + l.nome + '</div>' +
        '<div style="font-size:11px;color:var(--color-text-tertiary)">' + l.sku + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">' +
        '<span style="font-size:13px;font-weight:500;color:' + cor + '">' + est + ' un</span>' +
        (est <= l.estMin ? '<span class="badge br">Crítico</span>' : '') +
        '</div>' +
        '</div>' +
        '<div class="eb"><div class="ef" style="width:' + pct + '%;background:' + cor + '"></div></div>' +
        '</div>';
    }).join('') +
    '</div>'
  ).join('');

  document.getElementById('estq-grid').innerHTML = html;
}


/* =============================================================================
   13. CADASTROS — Livros, Kits, Alunos, Entradas
   CRUD simplificado para os dados de referência do sistema.
============================================================================= */

/* ── Livros ── */

/** Cadastra um novo livro/produto no DB e atualiza a interface. */
function cadLivro() {
  var nome = document.getElementById('l-nome').value.trim();
  if (!nome) { notif2('Informe o título', 'e'); return; }

  DB.livros.push({
    id: Date.now(),
    nome,
    sku: document.getElementById('l-sku').value || 'L' + DB.livros.length,
    serie: document.getElementById('l-serie').value,
    custo: parseFloat(document.getElementById('l-custo').value) || 0,
    preco: parseFloat(document.getElementById('l-preco').value) || 0,
    ncm: document.getElementById('l-ncm').value || '49019900',
    cfop: document.getElementById('l-cfop').value || '5117',
    cst: document.getElementById('l-cst').value || '41',
    estoque: { 1: 0, 2: 0, 3: 0 },
    estMin: parseInt(document.getElementById('l-min').value) || 5,
  });

  syncSelects();
  renderLivros();
  updateEmptyBanner();
  updateVendaGuard();
  saveDb();
  notif2('Livro cadastrado!', '');

  /* Limpa campos para novo cadastro */
  document.getElementById('l-nome').value = '';
  document.getElementById('l-sku').value = '';
}

/** Renderiza a lista de livros com barra de estoque total (soma das 3 sedes). */
function renderLivros() {
  var el = document.getElementById('livros-list');
  if (!DB.livros.length) { el.innerHTML = '<div class="empty">Nenhum livro</div>'; return; }

  el.innerHTML = DB.livros.map(l => {
    var tot = (l.estoque[1] || 0) + (l.estoque[2] || 0) + (l.estoque[3] || 0);
    var pct = Math.min(100, (tot / (l.estMin * 3 * 3)) * 100);
    var cor = tot <= l.estMin ? '#E24B4A' : tot <= l.estMin * 2 ? '#EF9F27' : '#1D9E75';

    return '<div style="padding:9px;border-bottom:0.5px solid var(--color-border-tertiary)">' +
      '<div style="display:flex;justify-content:space-between">' +
      '<div style="min-width:0;flex:1">' +
      '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + l.nome + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-tertiary)">' + l.sku + ' · ' + l.serie + ' · NCM: ' + l.ncm + '</div>' +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0;margin-left:8px">' +
      '<div style="font-size:13px;font-weight:500;color:#0F6E56">' + fmt(l.preco) + '</div>' +
      '<div style="font-size:11px;color:var(--color-text-tertiary)">S1:' + l.estoque[1] + ' S2:' + l.estoque[2] + ' S3:' + l.estoque[3] + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="eb"><div class="ef" style="width:' + pct + '%;background:' + cor + '"></div></div>' +
      '</div>';
  }).join('');
}

/* ── Kits ── */

/** Adiciona um livro ao kit em construção (buffer kitTemp). */
function addLivroKit() {
  var lid = document.getElementById('k-livro').value;
  var qtd = parseInt(document.getElementById('k-qtd').value) || 1;
  var preco = parseFloat(document.getElementById('k-preco').value) || 0;
  var l = gl(lid);
  if (!l) { notif2('Selecione um livro', 'e'); return; }
  DB.kitTemp.livros.push({ id: l.id, nome: l.nome, qtd, preco: preco || l.preco });
  renderKitTemp();
}

/** Renderiza a lista de livros do kit em construção. */
function renderKitTemp() {
  var el = document.getElementById('k-livros-list');
  if (!DB.kitTemp.livros.length) { el.innerHTML = '<div class="empty" style="padding:10px">Nenhum livro</div>'; return; }
  el.innerHTML = DB.kitTemp.livros.map((it, i) =>
    '<div class="pi">' +
    '<div class="pi-ico"><i class="ti ti-book-2" aria-hidden="true"></i></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + it.nome + '</div>' +
    '<div style="font-size:11px;color:var(--color-text-tertiary)">' + it.qtd + ' x ' + fmt(it.preco) + '</div>' +
    '</div>' +
    '<div class="rm" onclick="DB.kitTemp.livros.splice(' + i + ',1);renderKitTemp()"><i class="ti ti-x" aria-hidden="true"></i></div>' +
    '</div>'
  ).join('');
}

/** Salva o kit montado no DB. */
function salvarKit() {
  if (!DB.kitTemp.livros.length) { notif2('Adicione livros ao kit', 'e'); return; }
  var nome = document.getElementById('k-nome').value || 'Kit ' + document.getElementById('k-num').value;

  DB.kits.push({
    id: Date.now(),
    num: parseInt(document.getElementById('k-num').value),
    nome,
    ano: parseInt(document.getElementById('k-ano').value),
    series: document.getElementById('k-series').value,
    livros: [...DB.kitTemp.livros],
    ativo: true,
  });

  DB.kitTemp.livros = [];
  renderKitTemp();
  renderKits();
  updateEmptyBanner();
  saveDb();
  notif2('Kit salvo!', '');
}

/** Renderiza a lista de kits com totais e botão de toggle ativo/inativo. */
function renderKits() {
  var el = document.getElementById('kits-list');
  if (!DB.kits.length) { el.innerHTML = '<div class="empty">Nenhum kit</div>'; return; }
  el.innerHTML = DB.kits.map((k, i) =>
    '<div style="padding:10px;border:0.5px solid var(--color-border-tertiary);border-radius:8px;margin-bottom:8px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
    '<div>' +
    '<div style="font-size:13px;font-weight:500">' + k.nome + '</div>' +
    '<div style="font-size:12px;color:var(--color-text-tertiary)">' + k.series + ' · ' + k.ano + ' · ' + k.livros.length + ' livro(s)</div>' +
    '<div style="font-size:12px;font-weight:500;color:#0F6E56;margin-top:2px">Total: ' + fmt(k.livros.reduce((s, l) => s + l.qtd * l.preco, 0)) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:4px;align-items:center">' +
    '<span class="badge ' + (k.ativo ? 'bg' : 'bgr') + '">' + (k.ativo ? 'Ativo' : 'Inativo') + '</span>' +
    '<button class="btn btn-sm" onclick="DB.kits[' + i + '].ativo=!DB.kits[' + i + '].ativo;renderKits()"><i class="ti ti-toggle-' + (k.ativo ? 'right' : 'left') + '" aria-hidden="true"></i></button>' +
    '</div>' +
    '</div>' +
    '</div>'
  ).join('');
}

/* ── Alunos ── */

/** Cadastra uma nova matrícula de aluno no DB. */
function cadAluno() {
  var nome = document.getElementById('a-nome').value.trim();
  if (!nome) { notif2('Informe o nome do aluno', 'e'); return; }

  DB.alunos.push({
    id: Date.now(),
    nome,
    serie: document.getElementById('a-serie').value,
    sede: parseInt(document.getElementById('a-sede').value),
    resp: document.getElementById('a-resp').value,
    cpf: document.getElementById('a-cpf').value,
    email: document.getElementById('a-email').value,
    fone: document.getElementById('a-fone').value,
  });

  syncSelects();
  renderAlunos();
  saveDb();
  notif2('Matrícula cadastrada!', '');

  document.getElementById('a-nome').value = '';
  document.getElementById('a-resp').value = '';
}

/** Renderiza a lista de alunos matriculados. */
function renderAlunos() {
  var el = document.getElementById('alunos-list');
  if (!DB.alunos.length) { el.innerHTML = '<div class="empty">Nenhuma matrícula</div>'; return; }
  el.innerHTML = DB.alunos.map(a =>
    '<div style="padding:9px;border-bottom:0.5px solid var(--color-border-tertiary)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div>' +
    '<div style="font-size:13px;font-weight:500">' + a.nome + '</div>' +
    '<div style="font-size:12px;color:var(--color-text-tertiary)">' + a.serie + ' · Unidade ' + a.sede + '</div>' +
    '<div style="font-size:12px;color:var(--color-text-secondary)">Resp: ' + a.resp + (a.cpf ? ' · ' + a.cpf : '') + '</div>' +
    '</div>' +
    '<span class="badge bb">Ativo</span>' +
    '</div>' +
    '</div>'
  ).join('');
}

/* ── Entradas de Estoque ── */

/** Adiciona um item ao buffer de entrada antes de confirmar. */
function addItemEntrada() {
  var lid = document.getElementById('e-livro').value;
  var qtd = parseInt(document.getElementById('e-qtd').value) || 1;
  var custo = parseFloat(document.getElementById('e-custo').value) || 0;
  var pv = parseFloat(document.getElementById('e-pvenda').value) || 0;
  var l = gl(lid);
  if (!l) { notif2('Selecione um livro', 'e'); return; }
  DB.entradaTemp.push({ id: l.id, nome: l.nome, qtd, custo, pv });
  renderEntradaTemp();
}

/** Renderiza os itens do buffer de entrada. */
function renderEntradaTemp() {
  var el = document.getElementById('e-itens-list');
  if (!DB.entradaTemp.length) { el.innerHTML = '<div class="empty" style="padding:10px">Nenhum item</div>'; return; }
  el.innerHTML = DB.entradaTemp.map((it, i) =>
    '<div class="pi">' +
    '<div class="pi-ico"><i class="ti ti-book-2" aria-hidden="true"></i></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + it.nome + '</div>' +
    '<div style="font-size:11px;color:var(--color-text-tertiary)">' + it.qtd + ' un · custo ' + fmt(it.custo) + ' · venda ' + fmt(it.pv) + '</div>' +
    '</div>' +
    '<div class="rm" onclick="DB.entradaTemp.splice(' + i + ',1);renderEntradaTemp()"><i class="ti ti-x" aria-hidden="true"></i></div>' +
    '</div>'
  ).join('');
}

/**
 * Confirma a entrada de estoque: credita as quantidades na sede escolhida,
 * atualiza o preço de venda se informado, e registra no histórico.
 */
function confirmarEntrada() {
  if (!DB.entradaTemp.length) { notif2('Adicione itens', 'e'); return; }

  var sedeId = parseInt(document.getElementById('e-sede').value);
  var chave = document.getElementById('e-chave').value || '00000000000000000000000000000000000000000000';

  DB.entradaTemp.forEach(it => {
    var l = gl(it.id);
    if (l) {
      l.estoque[sedeId] = (l.estoque[sedeId] || 0) + it.qtd;
      if (it.pv) l.preco = it.pv; /* Atualiza o preço de venda se informado */
    }
  });

  DB.entradas.push({
    id: Date.now(),
    chave,
    forn: 'DIÁDICO EDITORA',
    sedeId,
    itens: [...DB.entradaTemp],
    data: new Date(),
    status: 'Entrada Registrada',
  });

  DB.entradaTemp = [];
  renderEntradaTemp();
  renderEntradas();
  syncSelects();
  renderLivros();
  saveDb();
  notif2('Entrada registrada! Estoque da unidade ' + sedeId + ' atualizado.', '');
}

/** Renderiza o histórico de entradas de estoque. */
function renderEntradas() {
  var el = document.getElementById('e-hist');
  if (!DB.entradas.length) { el.innerHTML = '<div class="empty">Nenhuma entrada</div>'; return; }
  el.innerHTML = DB.entradas.slice().reverse().map(e =>
    '<div style="padding:8px 0;border-bottom:0.5px solid var(--color-border-tertiary)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div>' +
    '<div style="font-size:13px;font-weight:500">DIÁDICO · ' + e.itens.length + ' livro(s)</div>' +
    '<div style="font-size:11px;color:var(--color-text-tertiary)">Unidade ' + e.sedeId + ' · ' + e.data.toLocaleDateString('pt-BR') + '</div>' +
    '</div>' +
    '<span class="badge bg">' + e.status + '</span>' +
    '</div>' +
    '</div>'
  ).join('');
}


/* =============================================================================
   14. SUPABASE (configuração futura)
   Integração planejada para substituir o localStorage como backend persistente.
   Enquanto não configurado, o sistema opera apenas com armazenamento local.
============================================================================= */

/** Lê as credenciais Supabase salvas no localStorage. */
function getSbCfg() {
  try {
    return {
      url: localStorage.getItem('escola_teste_sb_url') || '',
      key: localStorage.getItem('escola_teste_sb_key') || '',
      service: localStorage.getItem('escola_teste_sb_service') || '',
    };
  } catch (e) { return { url: '', key: '', service: '' }; }
}

/** Persiste as credenciais Supabase informadas pelo usuário. */
function saveSbCfg() {
  var url = (document.getElementById('sb-url') || { value: '' }).value.trim();
  var key = (document.getElementById('sb-key') || { value: '' }).value.trim();
  var svc = (document.getElementById('sb-service') || { value: '' }).value.trim();
  try {
    if (url) localStorage.setItem('escola_teste_sb_url', url);
    if (key) localStorage.setItem('escola_teste_sb_key', key);
    if (svc) localStorage.setItem('escola_teste_sb_service', svc);
  } catch (e) { }
  notif2('Credenciais Supabase salvas.', '');
  initSbUi();
}

/** Remove todas as credenciais Supabase do localStorage e limpa os campos. */
function clearSbCfg() {
  try {
    localStorage.removeItem('escola_teste_sb_url');
    localStorage.removeItem('escola_teste_sb_key');
    localStorage.removeItem('escola_teste_sb_service');
  } catch (e) { }
  var el = document.getElementById('sb-url'); if (el) el.value = '';
  var el2 = document.getElementById('sb-key'); if (el2) el2.value = '';
  var el3 = document.getElementById('sb-service'); if (el3) el3.value = '';
  notif2('Credenciais Supabase apagadas.', '');
  initSbUi();
}

/** Testa a conectividade com o projeto Supabase usando a Anon Key. */
async function testSupabase() {
  var cfg = getSbCfg();
  if (!cfg.url || !cfg.key) { notif2('Preencha URL e Anon Key antes de testar.', 'e'); return; }

  notif2('Testando conexão Supabase...', '');
  try {
    var res = await fetch(cfg.url + '/rest/v1/', {
      headers: { 'apikey': cfg.key, 'Authorization': 'Bearer ' + cfg.key },
    });
    var box = document.getElementById('sb-status-box');
    /* HTTP 200 ou 400 indicam que o projeto existe e a chave é válida */
    if (res.ok || res.status === 200 || res.status === 400) {
      if (box) box.innerHTML = '<div style="background:#d4edda;border:0.5px solid #28a745;border-radius:6px;padding:8px 10px;font-size:12px;color:#155724"><i class="ti ti-check" aria-hidden="true"></i> Conexão bem-sucedida com o projeto Supabase.</div>';
      notif2('Supabase conectado!', '');
    } else {
      if (box) box.innerHTML = '<div style="background:#f8d7da;border:0.5px solid #dc3545;border-radius:6px;padding:8px 10px;font-size:12px;color:#721c24"><i class="ti ti-x" aria-hidden="true"></i> Falha na conexão: HTTP ' + res.status + '. Verifique URL e chaves.</div>';
      notif2('Falha na conexão Supabase.', 'e');
    }
  } catch (e) { notif2('Erro de rede ao conectar Supabase.', 'e'); }
}

/** Inicializa o painel Supabase com o status atual das credenciais. */
function initSbUi() {
  var cfg = getSbCfg();
  var elUrl = document.getElementById('sb-url');
  if (elUrl && cfg.url) elUrl.value = cfg.url;

  var box = document.getElementById('sb-status-box');
  if (!box) return;

  if (cfg.url && cfg.key) {
    box.innerHTML = '<div class="alert"><i class="ti ti-check" aria-hidden="true" style="flex-shrink:0;margin-top:1px"></i><span>Credenciais configuradas. Clique em <strong>Testar conexão</strong> para verificar.</span></div>';
  } else {
    box.innerHTML = '<div class="alert"><i class="ti ti-clock" aria-hidden="true" style="flex-shrink:0;margin-top:1px"></i><span>Aguardando configuração. O sistema usa <strong>armazenamento local</strong> até a integração ser ativada.</span></div>';
  }
}

/**
 * Gera e faz o download do script SQL para criar as tabelas no Supabase.
 * Execute o arquivo resultante no SQL Editor do projeto Supabase.
 */
function exportSqlSupabase() {
  var sql = `-- Escola Teste NF-e — tabelas Supabase
-- Execute no SQL Editor do seu projeto Supabase

create table if not exists estoque (
  id uuid default gen_random_uuid() primary key,
  livro_id integer not null,
  sede_id integer not null,
  quantidade integer not null default 0,
  atualizado_em timestamptz default now()
);

create table if not exists fardamento (
  id serial primary key,
  nome text not null,
  sku text,
  ncm text,
  cfop text,
  cst text,
  preco numeric(10,2),
  estoque_json jsonb default '{}'
);

create table if not exists notas_nfe (
  id uuid default gen_random_uuid() primary key,
  api_ref text,
  numero text,
  chave text,
  status text,
  sede_id integer,
  dados_json jsonb,
  criado_em timestamptz default now()
);

create table if not exists notas_nfce (
  id uuid default gen_random_uuid() primary key,
  api_ref text,
  numero text,
  chave text,
  status text,
  sede_id integer,
  dados_json jsonb,
  criado_em timestamptz default now()
);
`;

  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sql], { type: 'text/sql' }));
  a.download = 'escola-teste-supabase.sql';
  a.click();
  URL.revokeObjectURL(a.href);
  notif2('SQL exportado.', '');
}


/* =============================================================================
   UTILITÁRIO DE NAVEGAÇÃO E NOTIFICAÇÃO
   (mantido aqui por ser transversal a todas as seções)
============================================================================= */

/**
 * Navega para uma página do SPA, ativando o item de menu correspondente
 * e disparando o carregamento de dados específico da seção.
 */
function go(id) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
    if (el.getAttribute('onclick') && el.getAttribute('onclick').includes("'" + id + "'"))
      el.classList.add('active');
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');

  /* Carregamento específico por seção */
  if (id === 'dashboard') updDash();
  if (id === 'hist') renderHist(DB.notas);
  if (id === 'nfce') { syncNfceProdSelect(); renderHistNfce(DB.notasNfce); }
  if (id === 'estoque') renderEstoque();
  if (id === 'kits') renderKits();
  if (id === 'livros') renderLivros();
  if (id === 'alunos') renderAlunos();
  if (id === 'config') initCfgUi();
  if (id === 'supabase') initSbUi();
  if (id === 'venda') { toggleDestBlock(); updateVendaGuard(); }
}

/**
 * Exibe uma notificação flutuante por 3 segundos.
 * @param {string} msg   Texto da notificação
 * @param {string} tipo  '' = sucesso | 'e' = erro | 'a' = aviso
 */
function notif2(msg, tipo) {
  var n = document.getElementById('notif');
  n.textContent = msg;
  n.style.background = tipo === 'e' ? '#A32D2D' : tipo === 'a' ? '#854F0B' : '#0F6E56';
  n.classList.add('show');
  setTimeout(() => n.classList.remove('show'), 3000);
}

/**
 * Exibe ou oculta o banner de aviso no topo quando o cadastro está incompleto
 * (sem livros e/ou sem kits configurados).
 */
function updateEmptyBanner() {
  var bar = document.getElementById('sec-top');
  if (!bar) return;
  var noL = !DB.livros.length;
  var noK = !DB.kits.length;

  if (noL || noK) {
    bar.className = 'sec-top warn show';
    var parts = [];
    if (noL) parts.push('sem produtos/livros');
    if (noK) parts.push('sem kits');
    bar.innerHTML =
      '<div><strong>Cadastro incompleto:</strong> ' + parts.join(' e ') + '.</div>' +
      '<div class="sec-actions">' +
      '<button type="button" class="btn btn-p btn-sm" onclick="go(\'livros\')"><i class="ti ti-book-2" aria-hidden="true"></i> Cadastrar produto/livro</button>' +
      '<button type="button" class="btn btn-sm" onclick="go(\'kits\')"><i class="ti ti-books" aria-hidden="true"></i> Cadastrar kit</button>' +
      '</div>';
  } else {
    bar.className = 'sec-top';
    bar.innerHTML = '';
  }
}


/* =============================================================================
   15. INICIALIZAÇÃO
   Sequência de boot: carrega dados → sincroniza UI → renderiza telas iniciais.
============================================================================= */
loadDb();                          // Recupera snapshot do localStorage
syncSelects();                     // Popula combos de livros/responsáveis
syncNfceProdSelect();              // Popula combo de fardamento na aba NF-Ce
renderLivros();                    // Lista inicial de livros
renderAlunos();                    // Lista inicial de alunos
renderKits();                      // Lista inicial de kits
updDash();                         // Indicadores do dashboard
initCfgUi();                       // Estado visual das configurações
updateEmptyBanner();               // Banner de cadastro incompleto
updateVendaGuard();                // Habilita/desabilita botão Transmitir

document.getElementById('v-sede').value = String(DB.sedeAtiva); // Sincroniza seletor de sede na venda