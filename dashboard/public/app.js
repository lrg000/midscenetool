const $ = (sel) => document.querySelector(sel);

const state = {
  catalog: [],
  selected: null,
  filter: 'all',
  tab: 'cases',
  running: false,
  recording: false,
  recordSessionId: null,
  catalogPage: 1,
  catalogPageSize: 8,
  reportPage: 1,
  reportPageSize: 10,
  reportTotal: 0,
  reportTotalPages: 0,
  l5Page: 1,
  l5PageSize: 10,
  l5Total: 0,
  l5TotalPages: 0,
  devices: [],
  selectedDeviceIds: new Set(),
  defaultAndroidPackage: '',
  launchApps: [],
  accounts: [],
  defaultMobile: '',
  defaultOtp: '',
  /** 当前账号输入是按哪条全流程预填的，避免来回点同一条时冲掉手改的号码 */
  accountSyncedFor: '',
  agents: [],
  defaultAgentId: 'bailian',
  selectedAgentId: 'bailian',
  /** @type {Record<string, {baseUrl?:string, modelName?:string, modelFamily?:string, apiKey?:string}>} */
  agentDrafts: {},
  /** @type {Array<{key:string,kind:string,id:string,title:string,deviceId:string,deviceLabel:string,skipLaunch?:boolean,runHandoff?:boolean,androidPackage?:string,mobile?:string,otp?:string,accountProfile?:string,agentId?:string,agentConfig?:object,runMode?:string}>} */
  jobs: [],
  deviceRefreshedAt: null,
  liveDevices: [],
  events: {
    cases: [],
    ai: [],
    locate: [],
    action: [],
    assert: [],
    l5: [],
  },
};

const els = {
  catalog: $('#catalog'),
  catalogPager: $('#catalogPager'),
  catalogCount: $('#catalogCount'),
  catalogPageSize: $('#catalogPageSize'),
  searchInput: $('#searchInput'),
  runTitle: $('#runTitle'),
  runDesc: $('#runDesc'),
  runTag: $('#runTag'),
  stepCounter: $('#stepCounter'),
  currentStep: $('#currentStep'),
  currentExpectation: $('#currentExpectation'),
  runStatus: $('#runStatus'),
  phaseInfo: $('#phaseInfo'),
  startBtn: $('#startBtn'),
  stopBtn: $('#stopBtn'),
  addJobBtn: $('#addJobBtn'),
  clearJobsBtn: $('#clearJobsBtn'),
  jobList: $('#jobList'),
  skipLaunchWrap: $('#skipLaunchWrap'),
  runHandoffWrap: $('#runHandoffWrap'),
  skipLaunch: $('#skipLaunch'),
  runHandoff: $('#runHandoff'),
  androidPackageWrap: $('#androidPackageWrap'),
  androidPackageInput: $('#androidPackageInput'),
  androidPackageList: $('#androidPackageList'),
  accountPresetWrap: $('#accountPresetWrap'),
  accountPreset: $('#accountPreset'),
  accountMobileWrap: $('#accountMobileWrap'),
  accountMobileInput: $('#accountMobileInput'),
  accountOtpWrap: $('#accountOtpWrap'),
  accountOtpInput: $('#accountOtpInput'),
  agentSelect: $('#agentSelect'),
  agentConfigBtn: $('#agentConfigBtn'),
  agentPopover: $('#agentPopover'),
  agentConfigTitle: $('#agentConfigTitle'),
  agentConfigDesc: $('#agentConfigDesc'),
  agentBaseUrl: $('#agentBaseUrl'),
  agentModelName: $('#agentModelName'),
  agentModelFamily: $('#agentModelFamily'),
  agentApiKey: $('#agentApiKey'),
  agentKeyHint: $('#agentKeyHint'),
  agentSaveBtn: $('#agentSaveBtn'),
  agentCloseBtn: $('#agentCloseBtn'),
  domainHint: $('#domainHint'),
  caseSummary: $('#caseSummary'),
  panel: $('#panel'),
  aiHint: $('#aiHint'),
  reportList: $('#reportList'),
  reportPager: $('#reportPager'),
  reportPageSize: $('#reportPageSize'),
  refreshReports: $('#refreshReports'),
  l5List: $('#l5List'),
  l5Pager: $('#l5Pager'),
  l5PageSize: $('#l5PageSize'),
  refreshL5: $('#refreshL5'),
  connLabel: $('#connLabel'),
  liveDot: $('#liveDot'),
  deviceList: $('#deviceList'),
  deviceRunStatus: $('#deviceRunStatus'),
  refreshDevices: $('#refreshDevices'),
  selectAllDevices: $('#selectAllDevices'),
  recordMode: $('#recordMode'),
  recordPackageId: $('#recordPackageId'),
  recordAppLabel: $('#recordAppLabel'),
  recordAndroidPkg: $('#recordAndroidPkg'),
  recordKind: $('#recordKind'),
  recordUrl: $('#recordUrl'),
  recordUrlWrap: $('#recordUrlWrap'),
  recordMobile: $('#recordMobile'),
  recordOtp: $('#recordOtp'),
  recordStartBtn: $('#recordStartBtn'),
  recordStopBtn: $('#recordStopBtn'),
  recordGenerateBtn: $('#recordGenerateBtn'),
  recordSkipLaunch: $('#recordSkipLaunch'),
  recordOverwrite: $('#recordOverwrite'),
  recordStatusLabel: $('#recordStatusLabel'),
  recordDeviceTools: $('#recordDeviceTools'),
  recordStepKind: $('#recordStepKind'),
  recordStepText: $('#recordStepText'),
  recordStepValue: $('#recordStepValue'),
  recordAddStepBtn: $('#recordAddStepBtn'),
  recordNewPageKey: $('#recordNewPageKey'),
  recordNewPageBtn: $('#recordNewPageBtn'),
  recordShotBtn: $('#recordShotBtn'),
  recordSuggestBtn: $('#recordSuggestBtn'),
  recordShotWrap: $('#recordShotWrap'),
  recordShotImg: $('#recordShotImg'),
  recordResult: $('#recordResult'),
};

function kindLabel(kind) {
  return { page: 'B单页', flow: 'B流程', aside: '包用例', explore: 'L3探索' }[kind] ?? kind;
}

/** 与后端一致：T* = 贷款壳，Y* = 独立 App */
function inferPackageKindClient(id) {
  if (!id) return 'standalone';
  const s = String(id).toLowerCase();
  if (s.includes('postlogin')) return 'loan-postlogin';
  if (s.startsWith('t')) return 'loan-shell';
  if (s.startsWith('y')) return 'standalone';
  return 'standalone';
}

function packageKindOf(item) {
  if (!item || item.kind !== 'aside') return null;
  return item.packageKind || inferPackageKindClient(item.id);
}

function isStandaloneAside(item) {
  return item?.kind === 'aside' && packageKindOf(item) === 'standalone';
}

function isLoanAside(item) {
  const pk = packageKindOf(item);
  return item?.kind === 'aside' && (pk === 'loan-shell' || pk === 'loan-postlogin');
}

function canHandoff(item) {
  return isLoanAside(item);
}

function isFullFlow(item) {
  return item?.kind === 'flow' && item.runMode === 'full-flow';
}

function currentAgentId() {
  return els.agentSelect?.value || state.selectedAgentId || state.defaultAgentId || 'bailian';
}

function agentLabel(id) {
  const agent = state.agents.find((a) => a.id === id);
  return agent?.label || id || '阿里百炼';
}

function fillAgentSelect() {
  if (!els.agentSelect) return;
  const current = currentAgentId();
  const options = (state.agents.length ? state.agents : [
    { id: 'bailian', label: '阿里百炼', configured: true, modelName: '', description: '' },
  ]).map((agent) => {
    const ready = agent.configured === false ? '（未配密钥）' : '';
    const model = agent.modelName ? ` · ${agent.modelName}` : '';
    return `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.label)}${escapeHtml(model)}${ready}</option>`;
  });
  els.agentSelect.innerHTML = options.join('');
  if ([...els.agentSelect.options].some((opt) => opt.value === current)) {
    els.agentSelect.value = current;
  } else {
    els.agentSelect.value = state.defaultAgentId || 'bailian';
  }
  state.selectedAgentId = els.agentSelect.value;
  fillAgentForm();
}

function selectedAgent() {
  return state.agents.find((a) => a.id === currentAgentId());
}

function snapshotAgentDraft() {
  const id = state.selectedAgentId || currentAgentId();
  if (!id) return;
  state.agentDrafts[id] = {
    baseUrl: els.agentBaseUrl?.value.trim() || '',
    modelName: els.agentModelName?.value.trim() || '',
    modelFamily: els.agentModelFamily?.value.trim() || '',
    apiKey: els.agentApiKey?.value || '',
  };
}

function fillAgentForm() {
  const agent = selectedAgent();
  const id = currentAgentId();
  const draft = state.agentDrafts[id] || {};
  if (els.agentBaseUrl) els.agentBaseUrl.value = draft.baseUrl || agent?.baseUrl || '';
  if (els.agentModelName) els.agentModelName.value = draft.modelName || agent?.modelName || '';
  if (els.agentModelFamily) els.agentModelFamily.value = draft.modelFamily || agent?.modelFamily || '';
  if (els.agentApiKey) els.agentApiKey.value = draft.apiKey || '';
  if (els.agentConfigTitle) els.agentConfigTitle.textContent = agent ? `${agent.label} 配置` : 'Agent 配置';
  if (els.agentConfigDesc) els.agentConfigDesc.textContent = agent?.description || '';
  if (els.agentKeyHint) {
    els.agentKeyHint.textContent = agent?.apiKeySet
      ? `已保存 ${agent.apiKeyHint || '密钥'}，输入框留空则沿用`
      : '尚未保存密钥，填写后可直接执行，或点保存写入本机';
  }
}

function readAgentConfigFromForm() {
  snapshotAgentDraft();
  const apiKey = els.agentApiKey?.value.trim() || '';
  return {
    baseUrl: els.agentBaseUrl?.value.trim() || '',
    modelName: els.agentModelName?.value.trim() || '',
    modelFamily: els.agentModelFamily?.value.trim() || '',
    ...(apiKey ? { apiKey } : {}),
  };
}

function agentReadyForRun() {
  if (els.agentApiKey?.value.trim()) return true;
  const agent = selectedAgent();
  return !agent || agent.configured !== false;
}

function applyAgentToJobs() {
  const agentId = currentAgentId();
  const agentConfig = readAgentConfigFromForm();
  for (const job of state.jobs) {
    job.agentId = agentId;
    job.agentConfig = agentConfig;
  }
}

function toggleAgentPopover(show) {
  if (!els.agentPopover) return;
  const open = show ?? els.agentPopover.hidden;
  els.agentPopover.hidden = !open;
  if (open) fillAgentForm();
}

async function saveAgentConfig() {
  snapshotAgentDraft();
  const id = currentAgentId();
  const payload = {
    id,
    baseUrl: els.agentBaseUrl?.value.trim() || '',
    modelName: els.agentModelName?.value.trim() || '',
    modelFamily: els.agentModelFamily?.value.trim() || '',
    apiKey: els.agentApiKey?.value.trim() || '',
  };
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error ?? '保存 Agent 配置失败');
    return;
  }
  if (Array.isArray(data.agents)) state.agents = data.agents;
  if (data.defaultId) state.defaultAgentId = data.defaultId;
  if (state.agentDrafts[id]) state.agentDrafts[id].apiKey = '';
  fillAgentSelect();
  applyAgentToJobs();
  renderJobs();
  if (els.agentKeyHint) els.agentKeyHint.textContent = '已保存到本机 agents.local.yaml，执行将使用该配置';
}

function domainBadge(item) {
  if (item.kind === 'explore') return { className: 'badge badge-b', text: 'L3' };
  if (item.kind === 'page') return { className: 'badge badge-b', text: 'B 单页' };
  if (item.kind === 'flow' && item.runMode === 'full-flow') return { className: 'badge badge-b', text: '全流程' };
  if (item.kind === 'flow' && item.runMode === 'segment') return { className: 'badge badge-b', text: '分段' };
  if (item.kind === 'flow') return { className: 'badge badge-b', text: 'B 流程' };
  const pk = packageKindOf(item);
  if (pk === 'loan-shell') return { className: 'badge badge-loan', text: '贷款壳' };
  if (pk === 'loan-postlogin') return { className: 'badge badge-loan-post', text: '贷款壳·已登录' };
  return { className: 'badge badge-standalone', text: '独立 App' };
}

function domainTagClass(item) {
  if (item.kind === 'page' || item.kind === 'flow') return 'tag tag-b';
  if (isLoanAside(item)) return 'tag tag-loan';
  if (isStandaloneAside(item)) return 'tag tag-standalone';
  return 'tag';
}

function domainTagText(item) {
  if (item.kind === 'explore') return 'L3 探索';
  if (item.kind === 'page') return 'B 面单页';
  if (item.kind === 'flow' && item.runMode === 'full-flow') return 'B 面全流程';
  if (item.kind === 'flow' && item.runMode === 'segment') return 'B 面分段';
  if (item.kind === 'flow') return 'B 面流程';
  const pk = packageKindOf(item);
  if (pk === 'loan-shell') return '贷款壳';
  if (pk === 'loan-postlogin') return '贷款壳 · 登录后';
  return '独立 App';
}

function filterCounts() {
  const all = state.catalog;
  return {
    all: all.length,
    page: all.filter((i) => i.kind === 'page').length,
    flow: all.filter((i) => i.kind === 'flow').length,
    'aside-standalone': all.filter((i) => isStandaloneAside(i)).length,
    'aside-loan': all.filter((i) => isLoanAside(i)).length,
  };
}

function updateFilterChipLabels() {
  const counts = filterCounts();
  const labels = {
    all: '全部',
    page: 'B 面单页',
    flow: 'B 面流程',
    'aside-standalone': '独立 App',
    'aside-loan': '贷款壳',
  };
  document.querySelectorAll('#filterRow .chip').forEach((btn) => {
    const f = btn.dataset.filter;
    const n = counts[f];
    const base = labels[f] || f;
    btn.textContent = typeof n === 'number' ? `${base} (${n})` : base;
  });
}

function emptyFilterHint() {
  const f = state.filter;
  if (f === 'aside-loan') {
    return (
      '当前没有「贷款壳」用例可显示。约定：包 id 以 T 开头为贷款壳（如 T42、T46），Y 开头为独立 App。'
    );
  }
  if (f === 'aside-standalone') {
    return '当前没有独立 App 用例。Y20–Y28、T46 等应出现在此。';
  }
  return '无匹配测试项';
}

function statusClass(status) {
  return { idle: 'idle', running: 'running', success: 'success', failed: 'failed', stopped: 'stopped' }[status] ?? 'idle';
}

function statusText(status) {
  return { idle: '空闲', running: '执行中', success: '已完成', failed: '失败', stopped: '已停止' }[status] ?? status;
}

/** 顶部流程导航互斥高亮：select | exec | report | config | record */
function setPipelineStep(step) {
  document.querySelectorAll('.pipeline .pipe-item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.pipe === step);
  });
}

function syncRecordModeUi() {
  const mode = els.recordMode.value;
  const isBrowser = mode === 'browser';
  els.recordUrlWrap.hidden = !isBrowser;
  const showDevice = mode === 'device' && state.recording;
  els.recordDeviceTools.hidden = !showDevice;
}

function applyRecordStatus(payload) {
  const rec = payload || {};
  state.recording = !!rec.active;
  state.recordSessionId = rec.sessionId || state.recordSessionId;
  const label = els.recordStatusLabel;
  label.classList.remove('is-recording', 'is-stopped');
  if (rec.active) {
    label.textContent = `录制中 · ${rec.mode} · ${rec.packageId || ''} · ${rec.stepCount || 0} 步`;
    label.classList.add('is-recording');
    els.recordStartBtn.disabled = true;
    els.recordStopBtn.disabled = false;
    els.recordGenerateBtn.disabled = true;
    setPipelineStep('record');
  } else if (rec.sessionId && rec.status === 'stopped') {
    label.textContent = `已停止 · ${rec.packageId || ''} · ${rec.stepCount || 0} 步 · 可落盘`;
    label.classList.add('is-stopped');
    els.recordStartBtn.disabled = !!state.running;
    els.recordStopBtn.disabled = true;
    els.recordGenerateBtn.disabled = false;
  } else {
    label.textContent = '空闲';
    els.recordStartBtn.disabled = !!state.running;
    els.recordStopBtn.disabled = true;
    els.recordGenerateBtn.disabled = !state.recordSessionId;
  }
  syncRecordModeUi();
  updateStartEnabled();
}

function showRecordResult(obj) {
  els.recordResult.hidden = false;
  els.recordResult.textContent =
    typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

async function startRecordSession() {
  const packageId = els.recordPackageId.value.trim();
  if (!packageId) {
    showRecordResult({ error: '请填写 packageId' });
    return;
  }
  const mode = els.recordMode.value;
  const body = {
    mode,
    packageId,
    appLabel: els.recordAppLabel.value.trim() || undefined,
    androidPackage: els.recordAndroidPkg.value.trim() || undefined,
    kind: els.recordKind.value || undefined,
    testMobile: els.recordMobile.value.trim() || undefined,
    testOtp: els.recordOtp.value.trim() || undefined,
    skipLaunch: els.recordSkipLaunch.checked,
  };
  if (mode === 'browser') {
    body.url = els.recordUrl.value.trim();
    if (!body.url) {
      showRecordResult({ error: '浏览器录制需要起始 URL' });
      return;
    }
  } else {
    const deviceId = [...state.selectedDeviceIds][0];
    if (deviceId) body.deviceId = deviceId;
  }
  els.recordStartBtn.disabled = true;
  try {
    const res = await fetch('/api/record/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.recordSessionId = data.sessionId;
    applyRecordStatus(data.status || { active: true, ...data.status });
    showRecordResult({ sessionId: data.sessionId, status: data.status });
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
    els.recordStartBtn.disabled = !!state.running;
  }
}

async function stopRecordSession() {
  try {
    const res = await fetch('/api/record/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.recordSessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyRecordStatus(data.status);
    showRecordResult({ stopped: true, status: data.status, pages: data.trace?.pages?.length });
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

async function generateRecordArtifacts() {
  try {
    const res = await fetch('/api/record/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.recordSessionId,
        overwrite: els.recordOverwrite.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showRecordResult(data);
    await loadCatalog();
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

async function addRecordStep() {
  const kind = els.recordStepKind.value;
  const text = els.recordStepText.value.trim();
  const value = els.recordStepValue.value.trim();
  const body = { kind, text: text || undefined, value: value || undefined };
  if (kind === 'native-input' && !body.valueKey) {
    body.valueKey = /otp/i.test(text) ? 'otp' : 'mobile';
  }
  try {
    const res = await fetch('/api/record/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyRecordStatus(data.status);
    els.recordStepText.value = '';
    els.recordStepValue.value = '';
    showRecordResult({ added: kind, status: data.status });
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

async function addRecordPage() {
  const pageKey = els.recordNewPageKey.value.trim();
  if (!pageKey) {
    showRecordResult({ error: '请填写 pageKey' });
    return;
  }
  try {
    const res = await fetch('/api/record/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyRecordStatus(data.status);
    els.recordNewPageKey.value = '';
    showRecordResult({ newPage: pageKey, status: data.status });
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

async function captureRecordShot() {
  try {
    const res = await fetch('/api/record/screenshot', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    els.recordShotWrap.hidden = false;
    els.recordShotImg.src = `${data.url}?t=${Date.now()}`;
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

async function suggestRecordVerify() {
  try {
    const res = await fetch('/api/record/suggest-verify', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    applyRecordStatus(data.status);
    showRecordResult({ summary: data.summary, status: data.status });
  } catch (err) {
    showRecordResult({ error: err.message || String(err) });
  }
}

function filteredCatalogItems() {
  const q = els.searchInput.value.trim().toLowerCase();
  return state.catalog.filter((item) => {
    const f = state.filter;
    if (f === 'page' && item.kind !== 'page') return false;
    if (f === 'flow' && item.kind !== 'flow') return false;
    if (f === 'explore' && item.kind !== 'explore') return false;
    if (f === 'aside-standalone' && !isStandaloneAside(item)) return false;
    if (f === 'aside-loan' && !isLoanAside(item)) return false;
    if (f === 'aside' && item.kind !== 'aside') return false;
    const hay = `${item.title} ${item.id} ${item.description} ${item.group} ${item.packageKind || ''}`.toLowerCase();
    return !q || hay.includes(q);
  });
}

function renderPager(container, { page, totalPages, total, onChange }) {
  if (!container) return;
  if (totalPages <= 1) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  container.innerHTML = `
    <button type="button" class="pager-btn" data-dir="prev" ${prevDisabled}>上一页</button>
    <span class="pager-info">${page} / ${totalPages}<span class="pager-total">（共 ${total}）</span></span>
    <button type="button" class="pager-btn" data-dir="next" ${nextDisabled}>下一页</button>
  `;
  container.querySelector('[data-dir="prev"]')?.addEventListener('click', () => {
    if (page > 1) onChange(page - 1);
  });
  container.querySelector('[data-dir="next"]')?.addEventListener('click', () => {
    if (page < totalPages) onChange(page + 1);
  });
}

function renderCatalog() {
  const items = filteredCatalogItems();
  const pageSize = state.catalogPageSize;
  const totalPages = items.length === 0 ? 0 : Math.ceil(items.length / pageSize);
  if (state.catalogPage > totalPages) state.catalogPage = Math.max(1, totalPages);
  if (state.catalogPage < 1) state.catalogPage = 1;

  const start = (state.catalogPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  els.catalogCount.textContent = items.length
    ? `共 ${items.length} 项 · 第 ${state.catalogPage}/${Math.max(totalPages, 1)} 页`
    : '0 项';

  els.catalog.innerHTML = '';
  if (!pageItems.length) {
    els.catalog.innerHTML = `<p class="empty">${escapeHtml(emptyFilterHint())}</p>`;
    updateFilterChipLabels();
    renderPager(els.catalogPager, {
      page: 1,
      totalPages: 0,
      total: 0,
      onChange: () => {},
    });
    return;
  }

  const groups = new Map();
  for (const item of pageItems) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }

  for (const [group, groupItems] of groups) {
    const section = document.createElement('div');
    section.className = 'catalog-group';
    section.innerHTML = `<h3>${group}</h3>`;
    for (const item of groupItems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalog-item' + (state.selected?.id === item.id && state.selected?.kind === item.kind ? ' is-selected' : '');
      const badge = domainBadge(item);
      btn.innerHTML =
        `<div class="catalog-item-head"><strong>${escapeHtml(item.title)}</strong>` +
        `<span class="${badge.className}">${badge.text}</span></div>` +
        `<span class="item-desc">${escapeHtml(item.description || item.id)}</span>`;
      btn.onclick = () => selectItem(item);
      section.appendChild(btn);
    }
    els.catalog.appendChild(section);
  }

  updateFilterChipLabels();

  renderPager(els.catalogPager, {
    page: state.catalogPage,
    totalPages,
    total: items.length,
    onChange: (p) => {
      state.catalogPage = p;
      renderCatalog();
    },
  });
}

function updateStartEnabled() {
  const hasDevice = [...state.selectedDeviceIds].some((id) =>
    state.devices.some((d) => d.udid === id && d.usable),
  );
  const busy = state.running || state.recording;
  els.addJobBtn.disabled = busy || !state.selected || !hasDevice;
  els.startBtn.disabled = busy || state.jobs.length === 0;
  els.stopBtn.disabled = !state.running;
  if (els.clearJobsBtn) els.clearJobsBtn.disabled = busy || state.jobs.length === 0;
  if (els.recordStartBtn && !state.recording) {
    els.recordStartBtn.disabled = state.running;
  }
  if (els.agentSelect) els.agentSelect.disabled = busy;
}

function selectItem(item) {
  state.selected = item;
  els.runTitle.textContent = item.title;
  els.runDesc.textContent = item.description || item.id;
  els.runTag.textContent = domainTagText(item);
  els.runTag.className = domainTagClass(item);

  const isAside = item.kind === 'aside' || item.kind === 'explore';
  const fullFlow = isFullFlow(item);
  els.skipLaunchWrap.hidden = !(isAside || fullFlow);
  for (const el of [
    els.androidPackageWrap,
    els.accountPresetWrap,
    els.accountMobileWrap,
    els.accountOtpWrap,
  ]) {
    if (el) el.hidden = !fullFlow;
  }
  if (fullFlow && els.androidPackageInput && !els.androidPackageInput.value.trim() && state.defaultAndroidPackage) {
    els.androidPackageInput.value = state.defaultAndroidPackage;
  }
  if (fullFlow) syncAccountFields(item.id);

  const handoffOk = canHandoff(item);
  // 独立 App 完全隐藏交接开关，避免误导
  els.runHandoffWrap.hidden = !handoffOk;
  els.runHandoff.disabled = !handoffOk;
  if (!handoffOk) {
    els.runHandoff.checked = false;
    els.runHandoffWrap.classList.remove('is-disabled');
  } else {
    els.runHandoffWrap.classList.remove('is-disabled');
  }

  if (els.domainHint) {
    if (isStandaloneAside(item)) {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent = '独立业务 App：不进 B 面模版；「A→B 交接」已禁用。';
    } else if (isLoanAside(item)) {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent =
        packageKindOf(item) === 'loan-postlogin'
          ? '贷款壳 · 登录后片段。需要进 H5 时再勾选「A→B 交接」。'
          : '贷款壳：自带协议/OTP 等登录前页；可勾选「A→B 交接」进入共享 B 面 H5（需配置 handoffFlow）。';
    } else if (item.kind === 'explore') {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent =
        'L3 有界探索：冷启 l5.yaml 的 explore.packageId，按 maxSteps 点击。不跑完整 YAML。';
    } else if (fullFlow) {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent = packageFieldHint();
    } else if (item.kind === 'flow') {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent = '分段流程：设备需已在流程内页面，不冷启 App。单页请用「B 面单页」。';
    } else if (item.kind === 'page') {
      els.domainHint.hidden = false;
      els.domainHint.className = 'domain-hint';
      els.domainHint.textContent = 'B 面单页：设备需已在该 H5 页。全流程请到「B 面流程」并填写要冷启的包名。';
    } else {
      els.domainHint.hidden = true;
      els.domainHint.textContent = '';
    }
  }

  updateStartEnabled();
  renderCatalog();
}

function fillPackageList() {
  if (!els.androidPackageList) return;
  const seen = new Set();
  const options = [];
  const push = (pkg, label) => {
    const value = (pkg || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  };
  if (state.defaultAndroidPackage) push(state.defaultAndroidPackage, '环境默认');
  for (const app of state.launchApps) {
    push(app.androidPackage, app.name || app.id);
  }
  els.androidPackageList.innerHTML = options.join('');
}

function knownPackageLabel(pkg) {
  const value = (pkg || '').trim();
  if (!value) return '';
  const match = state.launchApps.find((app) => app.androidPackage === value);
  if (match) return match.name;
  if (value === state.defaultAndroidPackage) return '环境默认';
  return '';
}

function fillAccountPresets() {
  if (!els.accountPreset) return;
  const options = ['<option value="">自定义</option>'];
  for (const account of state.accounts) {
    const label = `${account.id} · ${account.mobile}`;
    options.push(`<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`);
  }
  const current = els.accountPreset.value;
  els.accountPreset.innerHTML = options.join('');
  if ([...els.accountPreset.options].some((opt) => opt.value === current)) {
    els.accountPreset.value = current;
  }
}

function syncAccountFields(flowId) {
  if (state.accountSyncedFor === flowId) return;
  state.accountSyncedFor = flowId;
  const preset = state.accounts.find((account) => account.flow === flowId);
  if (preset) {
    if (els.accountPreset) els.accountPreset.value = preset.id;
    if (els.accountMobileInput) els.accountMobileInput.value = preset.mobile;
    if (els.accountOtpInput) els.accountOtpInput.value = preset.otp;
    return;
  }
  if (els.accountPreset) els.accountPreset.value = '';
  if (els.accountMobileInput && !els.accountMobileInput.value.trim()) {
    els.accountMobileInput.value = state.defaultMobile || '';
  }
  if (els.accountOtpInput && !els.accountOtpInput.value.trim()) {
    els.accountOtpInput.value = state.defaultOtp || '';
  }
}

function applySelectedPreset() {
  const preset = state.accounts.find((account) => account.id === els.accountPreset?.value);
  if (!preset) return;
  if (els.accountMobileInput) els.accountMobileInput.value = preset.mobile;
  if (els.accountOtpInput) els.accountOtpInput.value = preset.otp;
}

function markAccountCustomIfEdited() {
  const preset = state.accounts.find((account) => account.id === els.accountPreset?.value);
  if (!preset || !els.accountPreset) return;
  const mobile = els.accountMobileInput?.value.trim() || '';
  const otp = els.accountOtpInput?.value.trim() || '';
  if (preset.mobile !== mobile || preset.otp !== otp) els.accountPreset.value = '';
}

function accountProfileForJob(flowId, mobile, otp) {
  const preset = state.accounts.find((account) => account.id === els.accountPreset?.value);
  if (!preset || preset.mobile !== mobile || preset.otp !== otp) return undefined;
  if (flowId === 'business-auto' || preset.flow === flowId) return preset.id;
  return undefined;
}

function packageFieldHint() {
  const pkg = els.androidPackageInput?.value.trim() || '';
  const known = knownPackageLabel(pkg);
  const knownNote = known ? `（${known}）` : '（自定义包名）';
  const mobile = els.accountMobileInput?.value.trim() || '';
  const otp = els.accountOtpInput?.value.trim() || '';
  const preset = state.accounts.find((account) => account.id === els.accountPreset?.value);
  const accountNote = mobile
    ? `登录使用 ${mobile}${otp ? ` / OTP ${otp}` : ''}${preset ? `（${preset.id}）` : '（自定义账号）'}。`
    : '需要填写登录手机号和 OTP。';
  const launchNote = pkg
    ? `全流程将冷启 ${pkg}${knownNote}，再走 bootstrap → 登录 → 业务页。`
    : '全流程需要填写要冷启的 Android 包名。';
  return `${launchNote}${accountNote}包名、手机号、OTP 都可以改成未登记的值。`;
}

function refreshFullFlowHint() {
  if (!isFullFlow(state.selected) || !els.domainHint) return;
  els.domainHint.hidden = false;
  els.domainHint.className = 'domain-hint';
  els.domainHint.textContent = packageFieldHint();
}

function jobKey(kind, id, deviceId) {
  return `${kind}::${id}::${deviceId}`;
}

function renderJobs() {
  if (!els.jobList) return;
  if (!state.jobs.length) {
    els.jobList.innerHTML = '<p class="empty">队列为空。可添加多条「用例 × 设备」后开始并行。</p>';
    updateStartEnabled();
    return;
  }
  els.jobList.innerHTML = state.jobs.map((j) => {
    const badge = domainBadge(j);
    const handoffNote = j.runHandoff ? ' · A→B' : '';
    const skipNote = j.skipLaunch ? ' · 跳过启动' : '';
    const pkgNote = j.androidPackage ? ` · ${j.androidPackage}` : '';
    const accountNote = j.mobile ? ` · ${j.mobile}${j.otp ? ` / ${j.otp}` : ''}` : '';
    const agentNote = j.agentId
      ? ` · ${agentLabel(j.agentId)}${j.agentConfig?.modelName ? `/${j.agentConfig.modelName}` : ''}`
      : '';
    return `
    <div class="job-row" data-job-key="${escapeHtml(j.key)}">
      <div class="job-case">
        <strong>${escapeHtml(j.title)}</strong>
        <span class="muted"><span class="${badge.className}">${badge.text}</span> ${escapeHtml(j.id)}${escapeHtml(pkgNote)}${escapeHtml(accountNote)}${escapeHtml(agentNote)}${handoffNote}${skipNote}</span>
      </div>
      <div class="job-device">
        <strong>${escapeHtml(j.deviceLabel || j.deviceId)}</strong>
        <span class="muted">${escapeHtml(j.deviceId)}</span>
      </div>
      <button type="button" class="btn remove-job" data-remove-job="${escapeHtml(j.key)}" ${state.running ? 'disabled' : ''}>移除</button>
    </div>
  `;
  }).join('');

  els.jobList.querySelectorAll('[data-remove-job]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-remove-job');
      state.jobs = state.jobs.filter((j) => j.key !== key);
      renderJobs();
    });
  });
  updateStartEnabled();
}

function readFullFlowOverrides() {
  return {
    androidPackage: els.androidPackageInput?.value.trim() || '',
    mobile: els.accountMobileInput?.value.trim() || '',
    otp: els.accountOtpInput?.value.trim() || '',
    skipLaunch: Boolean(els.skipLaunch?.checked),
    agentId: currentAgentId(),
    agentConfig: readAgentConfigFromForm(),
  };
}

function applyOverridesToJob(job, overrides) {
  if (job.runMode !== 'full-flow' && job.kind !== 'flow') return false;
  if (overrides.androidPackage) job.androidPackage = overrides.androidPackage;
  if (overrides.mobile) job.mobile = overrides.mobile;
  if (overrides.otp) job.otp = overrides.otp;
  job.skipLaunch = overrides.skipLaunch;
  job.agentId = overrides.agentId;
  job.agentConfig = overrides.agentConfig;
  job.accountProfile = accountProfileForJob(job.id, job.mobile, job.otp);
  return true;
}

/** 加入队列之后改包名 / 账号 / OTP / Agent，写回同用例的队列项 */
function syncQueuedJobsFromForm() {
  if (state.running || !state.selected || !state.jobs.length) return;
  const item = state.selected;
  let changed = false;
  const agentId = currentAgentId();
  const agentConfig = readAgentConfigFromForm();
  for (const job of state.jobs) {
    if (job.kind !== item.kind || job.id !== item.id) continue;
    if (isFullFlow(item)) {
      applyOverridesToJob(job, readFullFlowOverrides());
      changed = true;
    } else {
      if (item.kind === 'aside' || item.kind === 'explore') {
        job.skipLaunch = els.skipLaunch.checked;
        job.runHandoff = canHandoff(item) ? els.runHandoff.checked : undefined;
      }
      job.agentId = agentId;
      job.agentConfig = agentConfig;
      changed = true;
    }
  }
  if (changed) renderJobs();
}

function addSelectedToQueue() {
  if (!state.selected || state.running) return;
  const deviceIds = [...state.selectedDeviceIds].filter((id) =>
    state.devices.some((d) => d.udid === id && d.usable),
  );
  if (!deviceIds.length) {
    alert('请至少勾选一台可用设备');
    return;
  }

  if (!agentReadyForRun()) {
    alert(`视觉 Agent「${agentLabel(currentAgentId())}」未配置密钥。请点「配置」填写 API Key。`);
    toggleAgentPopover(true);
    els.agentApiKey?.focus();
    return;
  }

  const fullFlow = isFullFlow(state.selected);
  const androidPackage = fullFlow ? (els.androidPackageInput?.value.trim() || '') : '';
  const mobile = fullFlow ? (els.accountMobileInput?.value.trim() || '') : '';
  const otp = fullFlow ? (els.accountOtpInput?.value.trim() || '') : '';
  if (fullFlow && !androidPackage) {
    alert('全流程需要填写要测试的应用包名');
    els.androidPackageInput?.focus();
    return;
  }
  if (fullFlow && !mobile) {
    alert('全流程需要填写登录手机号');
    els.accountMobileInput?.focus();
    return;
  }
  if (fullFlow && !otp) {
    alert('全流程需要填写 OTP');
    els.accountOtpInput?.focus();
    return;
  }

  const added = [];
  const skipped = [];
  for (const deviceId of deviceIds) {
    const device = state.devices.find((d) => d.udid === deviceId);
    const key = jobKey(state.selected.kind, state.selected.id, deviceId);
    if (state.jobs.some((j) => j.deviceId === deviceId)) {
      skipped.push(`${device?.label || deviceId}（设备已被占用）`);
      continue;
    }
    if (state.jobs.some((j) => j.key === key)) {
      skipped.push(`${device?.label || deviceId}（任务已存在）`);
      continue;
    }
    state.jobs.push({
      key,
      kind: state.selected.kind,
      id: state.selected.id,
      title: state.selected.title,
      runMode: state.selected.runMode,
      packageKind: packageKindOf(state.selected) || undefined,
      deviceId,
      deviceLabel: device?.label || deviceId,
      skipLaunch: state.selected.kind === 'aside' || fullFlow ? els.skipLaunch.checked : undefined,
      androidPackage: fullFlow ? androidPackage : undefined,
      mobile: fullFlow ? mobile : undefined,
      otp: fullFlow ? otp : undefined,
      accountProfile: fullFlow ? accountProfileForJob(state.selected.id, mobile, otp) : undefined,
      agentId: currentAgentId(),
      agentConfig: readAgentConfigFromForm(),
      // 独立 App 强制不交接，避免误勾
      runHandoff:
        state.selected.kind === 'aside' && canHandoff(state.selected)
          ? els.runHandoff.checked
          : undefined,
    });
    added.push(device?.label || deviceId);
  }

  renderJobs();
  if (!added.length) {
    alert(`未能加入队列：\n${skipped.join('\n')}`);
    return;
  }
  els.runDesc.textContent = `已加入 ${added.length} 条任务到并行队列（共 ${state.jobs.length} 条）` +
    (skipped.length ? `；跳过：${skipped.join('、')}` : '');
}

function renderDevices() {
  if (!state.devices.length) {
    els.deviceList.innerHTML = '<p class="empty">未检测到已连接设备。请用 USB/无线调试连接后点击「刷新设备」。</p>';
    updateStartEnabled();
    return;
  }

  els.deviceList.innerHTML = state.devices.map((d) => {
    const checked = state.selectedDeviceIds.has(d.udid);
    const disabled = !d.usable || state.running;
    const meta = [d.resolution, d.density != null ? `${d.density}dpi` : null].filter(Boolean).join(' · ');
    return `
      <label class="device-card ${checked ? 'is-selected' : ''} ${!d.usable ? 'is-disabled' : ''}">
        <input type="checkbox" data-udid="${escapeHtml(d.udid)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <div class="device-main">
          <strong>${escapeHtml(d.label || d.udid)}</strong>
          <span>${escapeHtml(d.udid)}</span>
        </div>
        <div class="device-meta">
          <span class="device-state ${d.usable ? 'ok' : 'bad'}">${escapeHtml(d.state)}</span>
          <span>${escapeHtml(meta || '—')}</span>
        </div>
      </label>`;
  }).join('');

  els.deviceList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const udid = input.dataset.udid;
      if (input.checked) state.selectedDeviceIds.add(udid);
      else state.selectedDeviceIds.delete(udid);
      renderDevices();
    });
  });

  updateStartEnabled();
}

function renderDeviceRunStatus(devices) {
  state.liveDevices = devices ?? [];
  if (!state.liveDevices.length) {
    els.deviceRunStatus.hidden = true;
    els.deviceRunStatus.innerHTML = '';
    return;
  }
  els.deviceRunStatus.hidden = false;
  els.deviceRunStatus.innerHTML = state.liveDevices.map((d) => {
    const canStop = d.status === 'running';
    const caseLine = d.caseTitle ? d.caseTitle : '';
    const stepLine = d.currentStep || `通过 ${d.passed} · 失败 ${d.failed}`;
    return `
    <div class="device-run-chip" data-device-id="${escapeHtml(d.deviceId)}">
      <span class="chip-title" title="${escapeHtml(d.deviceId)}">
        ${escapeHtml(d.label || d.deviceId)}
        ${caseLine ? `<span class="muted">${escapeHtml(caseLine)}</span>` : ''}
      </span>
      <span class="status-pill ${statusClass(d.status)}">${statusText(d.status)}</span>
      <span class="chip-step">${escapeHtml(stepLine)}</span>
      <button type="button" class="btn stop-one" data-stop-device="${escapeHtml(d.deviceId)}" ${canStop ? '' : 'disabled'}>
        ${canStop ? '停止' : d.status === 'stopped' ? '已停' : '—'}
      </button>
    </div>`;
  }).join('');

  els.deviceRunStatus.querySelectorAll('[data-stop-device]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-stop-device');
      if (id) stopRun(id);
    });
  });
}

function resetEvidence() {
  state.events = { cases: [], ai: [], locate: [], action: [], assert: [], l5: [] };
  renderPanel();
}

function pushEvidence(event) {
  const devicePrefix = event.deviceLabel || event.deviceId
    ? `[${event.deviceLabel || event.deviceId}] `
    : '';

  if (event.type === 'case') {
    state.events.cases.unshift({
      name: `${devicePrefix}${event.name}`,
      status: event.status,
      error: event.error,
      at: new Date().toLocaleTimeString(),
    });
    return;
  }
  if (event.type === 'ai:start' || event.type === 'ai:end') {
    const bucket = categorizeAi(event.method);
    const row = {
      method: event.method,
      prompt: `${devicePrefix}${event.prompt}`,
      durationMs: event.durationMs,
      success: event.success,
      pending: event.type === 'ai:start',
      at: new Date().toLocaleTimeString(),
    };
    if (event.type === 'ai:start') {
      state.events[bucket].unshift(row);
    } else {
      const list = state.events[bucket];
      const idx = list.findIndex((r) => r.pending && r.method === event.method && r.prompt === row.prompt);
      if (idx >= 0) Object.assign(list[idx], row, { pending: false });
      else list.unshift(row);
    }
  }
  if (event.type === 'l5') {
    state.events.l5.unshift({
      name: `${devicePrefix}[${event.channel}] ${event.name}`,
      status: event.status,
      error: event.detail,
      at: new Date().toLocaleTimeString(),
      reportPath: event.reportPath,
    });
    return;
  }
  if (event.type === 'log') {
    state.events.cases.unshift({
      name: `${devicePrefix}${event.message}`,
      status: 'passed',
      at: new Date().toLocaleTimeString(),
    });
  }
}

function categorizeAi(method) {
  if (method === 'aiLocate') return 'locate';
  if (method === 'aiAssert' || method === 'aiWaitFor' || method === 'aiBoolean') return 'assert';
  if (['aiTap', 'aiInput', 'aiScroll', 'aiLongPress', 'aiAct', 'aiAction', 'aiClearInput', 'aiKeyboardPress'].includes(method)) {
    return 'action';
  }
  return 'ai';
}

function renderPanel() {
  const tab = state.tab;
  const rows = state.events[tab] ?? [];
  if (!rows.length) {
    els.panel.innerHTML = '<p class="empty">暂无数据，开始执行后将在此显示实时证据</p>';
    return;
  }

  if (tab === 'cases' || tab === 'l5') {
    els.panel.innerHTML = rows.map((r) => `
      <div class="row ${r.status}">
        <div class="key">${r.at} · ${r.status}</div>
        <div class="val">${escapeHtml(r.name)}${r.error ? `\n${escapeHtml(r.error)}` : ''}${
          r.reportPath
            ? `\n<a href="/${r.reportPath.replace(/^\/+/, '')}" target="_blank">打开诊断</a>`
            : ''
        }</div>
      </div>`).join('');
    return;
  }

  els.panel.innerHTML = rows.slice(0, 80).map((r) => `
    <div class="row ${r.success === false ? 'fail' : r.success ? 'pass' : ''}">
      <div class="key">${r.at}<br>${escapeHtml(r.method)}${r.durationMs != null ? `<br>${r.durationMs} ms` : ''}</div>
      <div class="val">${escapeHtml(r.prompt)}</div>
    </div>`).join('');
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMtime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso ?? '';
  }
}

function applyLiveState(s) {
  els.stepCounter.textContent = `${s.stepIndex || 0} / ${s.stepTotal || 0}`;
  els.currentStep.textContent = s.currentStep || '—';
  els.currentExpectation.textContent = s.currentExpectation || '—';
  els.runStatus.textContent = statusText(s.status);
  els.runStatus.className = `status-pill ${statusClass(s.status)}`;
  const deviceFocus = s.focusDeviceId
    ? (s.devices || []).find((d) => d.deviceId === s.focusDeviceId)?.label || s.focusDeviceId
    : null;
  els.phaseInfo.textContent = [
    s.phase,
    deviceFocus && `设备 ${deviceFocus}`,
    s.pageTitle && `页面 ${s.pageIndex}/${s.pageTotal}: ${s.pageTitle}`,
  ].filter(Boolean).join(' · ') || '—';
  els.caseSummary.textContent = `通过 ${s.passed} · 失败 ${s.failed} · 跳过 ${s.skipped}`;
  state.running = s.status === 'running';
  updateStartEnabled();
  renderDeviceRunStatus(s.devices);
  if (s.status === 'running') {
    setPipelineStep('exec');
    const caseCount = new Set((s.devices || []).map((d) => d.caseTitle).filter(Boolean)).size;
    els.aiHint.textContent = (s.devices?.length > 1)
      ? `并行中：${caseCount || s.devices.length} 用例 / ${s.devices.length} 设备…`
      : 'Midscene Agent 正在执行…';
  } else if (s.status === 'stopped') {
    els.aiHint.textContent = '执行已由用户停止';
    setPipelineStep('report');
  } else if (s.status === 'success' || s.status === 'failed') {
    setPipelineStep('report');
    if (s.targetLabel) {
      els.aiHint.textContent = s.error || '执行结束，可查看报告';
    } else if (s.reportPath) {
      els.aiHint.textContent = '执行结束，可查看报告';
    }
  } else if (s.status === 'idle') {
    setPipelineStep('select');
  } else if (s.targetLabel) {
    els.aiHint.textContent = s.error || '执行结束，可查看报告';
  } else if (s.reportPath) {
    els.aiHint.textContent = '执行结束，可查看报告';
  }
}

async function loadCatalog() {
  const res = await fetch('/api/catalog');
  const data = await res.json();
  state.catalog = data.items ?? [];
  state.defaultAndroidPackage = (data.defaultAndroidPackage || '').trim();
  state.launchApps = data.launchApps ?? [];
  state.accounts = data.accounts ?? [];
  state.defaultMobile = (data.defaultMobile || '').trim();
  state.defaultOtp = (data.defaultOtp || '').trim();
  state.agents = data.agents ?? [];
  state.defaultAgentId = data.defaultAgentId || 'bailian';
  if (!state.agents.some((a) => a.id === state.selectedAgentId)) {
    state.selectedAgentId = state.defaultAgentId;
  }
  state.catalogPage = 1;
  fillPackageList();
  fillAccountPresets();
  fillAgentSelect();
  renderCatalog();
}

async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    state.devices = data.devices ?? [];
    state.deviceRefreshedAt = data.refreshedAt ?? null;

    const usableIds = new Set(state.devices.filter((d) => d.usable).map((d) => d.udid));
    for (const id of [...state.selectedDeviceIds]) {
      if (!usableIds.has(id)) state.selectedDeviceIds.delete(id);
    }
    if (!state.selectedDeviceIds.size) {
      const first = state.devices.find((d) => d.usable);
      if (first) state.selectedDeviceIds.add(first.udid);
    }
    renderDevices();
  } catch (err) {
    els.deviceList.innerHTML = `<p class="empty">设备列表加载失败：${escapeHtml(err.message || err)}</p>`;
    updateStartEnabled();
  }
}

async function loadReports(page = state.reportPage) {
  const pageSize = state.reportPageSize;
  const res = await fetch(`/api/reports?page=${page}&pageSize=${pageSize}`);
  const data = await res.json();
  const list = data.reports ?? [];
  state.reportPage = data.page ?? page;
  state.reportPageSize = data.pageSize ?? pageSize;
  state.reportTotal = data.total ?? list.length;
  state.reportTotalPages = data.totalPages ?? 0;

  if (!list.length) {
    els.reportList.innerHTML = '<p class="empty">暂无历史报告</p>';
  } else {
    els.reportList.innerHTML = list.map((r) => {
      const base = r.name.replace(/\.json$/, '');
      return `<div class="report-item">
        <div class="report-main">
          <span class="report-name">${escapeHtml(base)}</span>
          <span class="report-meta">${formatMtime(r.mtime)}</span>
        </div>
        <span class="report-links">
          <a href="/midscene_run/output/${encodeURIComponent(base)}-report.html" target="_blank">可视化报告</a>
          ·
          <a href="/midscene_run/output/${encodeURIComponent(r.name)}" target="_blank">JSON</a>
        </span>
      </div>`;
    }).join('');
  }

  renderPager(els.reportPager, {
    page: state.reportPage,
    totalPages: state.reportTotalPages,
    total: state.reportTotal,
    onChange: (p) => {
      state.reportPage = p;
      loadReports(p);
    },
  });
}

async function loadL5Reports(page = state.l5Page) {
  if (!els.l5List) return;
  const pageSize = state.l5PageSize;
  const res = await fetch(`/api/l5/reports?page=${page}&pageSize=${pageSize}`);
  const data = await res.json();
  const list = data.reports ?? [];
  state.l5Page = data.page ?? page;
  state.l5PageSize = data.pageSize ?? pageSize;
  state.l5Total = data.total ?? list.length;
  state.l5TotalPages = data.totalPages ?? 0;

  if (!list.length) {
    els.l5List.innerHTML = '<p class="empty">暂无 L5 诊断。跑含 checkpoint 的用例或失败后会出现。</p>';
  } else {
    els.l5List.innerHTML = list.map((r) => `
      <div class="report-item">
        <div class="report-main">
          <span class="report-name">${escapeHtml(r.kind || 'diagnose')} · ${escapeHtml(String(r.title || r.name).slice(0, 80))}</span>
          <span class="report-meta">${formatMtime(r.mtime)}</span>
        </div>
        <span class="report-links">
          <a href="/midscene_run/l5/${encodeURIComponent(r.mdName)}" target="_blank">诊断 Markdown</a>
          ·
          <a href="/midscene_run/l5/${encodeURIComponent(r.name)}" target="_blank">JSON</a>
        </span>
      </div>`).join('');
  }

  renderPager(els.l5Pager, {
    page: state.l5Page,
    totalPages: state.l5TotalPages,
    total: state.l5Total,
    onChange: (p) => {
      state.l5Page = p;
      loadL5Reports(p);
    },
  });
}

async function stopRun(deviceId) {
  if (!state.running) return;
  const isSingle = Boolean(deviceId);
  if (isSingle) {
    const btn = els.deviceRunStatus.querySelector(`[data-stop-device="${CSS.escape(deviceId)}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '停止中…';
    }
  } else {
    els.stopBtn.disabled = true;
    els.stopBtn.textContent = '停止中…';
  }
  try {
    const res = await fetch('/api/run/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isSingle ? { deviceId } : {}),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.message ?? data.error ?? '停止失败');
    } else {
      els.aiHint.textContent = data.message || (isSingle ? '正在停止该设备…' : '正在全部停止…');
    }
  } catch (err) {
    alert(`停止请求失败: ${err.message || err}`);
  } finally {
    if (!isSingle) {
      els.stopBtn.textContent = '全部停止';
      els.stopBtn.disabled = !state.running;
    }
    updateStartEnabled();
  }
}

async function startRun() {
  if (state.running) return;
  if (!state.jobs.length) {
    alert('请先将「用例 × 设备」加入并行队列');
    return;
  }

  const fullFlowJobs = state.jobs.filter((j) => j.runMode === 'full-flow' || (j.kind === 'flow' && j.id?.startsWith('business-')));
  if (fullFlowJobs.length) {
    const overrides = readFullFlowOverrides();
    if (!overrides.androidPackage) {
      alert('全流程需要填写要测试的应用包名');
      els.androidPackageInput?.focus();
      return;
    }
    if (!overrides.mobile) {
      alert('全流程需要填写登录手机号');
      els.accountMobileInput?.focus();
      return;
    }
    if (!overrides.otp) {
      alert('全流程需要填写 OTP');
      els.accountOtpInput?.focus();
      return;
    }
    if (!agentReadyForRun()) {
      alert(`视觉 Agent「${agentLabel(currentAgentId())}」未配置密钥。请点「配置」填写 API Key。`);
      toggleAgentPopover(true);
      els.agentApiKey?.focus();
      return;
    }
    for (const job of fullFlowJobs) applyOverridesToJob(job, overrides);
    renderJobs();
  } else if (!agentReadyForRun()) {
    alert(`视觉 Agent「${agentLabel(currentAgentId())}」未配置密钥。请点「配置」填写 API Key。`);
    toggleAgentPopover(true);
    els.agentApiKey?.focus();
    return;
  }
  applyAgentToJobs();

  resetEvidence();
  const body = {
    jobs: state.jobs.map((j) => ({
      kind: j.kind,
      id: j.id,
      deviceId: j.deviceId,
      title: j.title,
      skipLaunch: j.skipLaunch,
      runHandoff: j.runHandoff,
      androidPackage: j.androidPackage,
      mobile: j.mobile,
      otp: j.otp,
      accountProfile: j.accountProfile,
      agentId: j.agentId,
      agentConfig: j.agentConfig,
    })),
  };
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error ?? '启动失败');
    return;
  }
  els.runTitle.textContent = `并行批次（${state.jobs.length} 任务）`;
  els.runTag.textContent = '混合并行';
  setPipelineStep('exec');
  renderDevices();
  renderJobs();
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onopen = () => {
    els.connLabel.textContent = '实时连接';
    els.liveDot.classList.add('on');
  };
  source.onerror = () => {
    els.connLabel.textContent = '连接断开，重试中…';
    els.liveDot.classList.remove('on');
  };
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    pushEvidence(event);
    renderPanel();
    if (event.type === 'run:end') {
      state.reportPage = 1;
      loadReports(1);
      state.l5Page = 1;
      loadL5Reports(1);
      setPipelineStep('report');
    }
    if (event.type === 'l5' && event.reportPath) {
      loadL5Reports(state.l5Page);
    }
    if (event.type === 'batch:start' || event.type === 'run:start') {
      setPipelineStep('exec');
    }
  };
}

async function pollState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    const wasRunning = state.running;
    applyLiveState(data.state ?? {});
    state.running = !!data.running || data.state?.status === 'running';
    if (data.record) applyRecordStatus(data.record);
    else state.recording = !!data.recording;
    updateStartEnabled();
    if (wasRunning !== state.running) {
      renderDevices();
    }
  } catch {
    // ignore
  }
}

document.querySelectorAll('#filterRow .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filterRow .chip').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filter = btn.dataset.filter;
    state.catalogPage = 1;
    renderCatalog();
  });
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.tab = btn.dataset.tab;
    renderPanel();
  });
});

els.agentSelect?.addEventListener('change', () => {
  snapshotAgentDraft();
  state.selectedAgentId = currentAgentId();
  fillAgentForm();
  applyAgentToJobs();
  syncQueuedJobsFromForm();
});
els.agentConfigBtn?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  toggleAgentPopover();
});
els.agentCloseBtn?.addEventListener('click', () => toggleAgentPopover(false));
els.agentSaveBtn?.addEventListener('click', () => saveAgentConfig());
['input', 'change'].forEach((evt) => {
  els.agentBaseUrl?.addEventListener(evt, () => {
    snapshotAgentDraft();
    applyAgentToJobs();
    renderJobs();
  });
  els.agentModelName?.addEventListener(evt, () => {
    snapshotAgentDraft();
    applyAgentToJobs();
    renderJobs();
  });
  els.agentModelFamily?.addEventListener(evt, () => {
    snapshotAgentDraft();
    applyAgentToJobs();
  });
  els.agentApiKey?.addEventListener(evt, snapshotAgentDraft);
});
document.addEventListener('click', (ev) => {
  if (!els.agentPopover || els.agentPopover.hidden) return;
  const picker = ev.target?.closest?.('.agent-picker');
  if (!picker) toggleAgentPopover(false);
});
els.androidPackageInput?.addEventListener('input', () => {
  refreshFullFlowHint();
  syncQueuedJobsFromForm();
});
els.accountPreset?.addEventListener('change', () => {
  applySelectedPreset();
  refreshFullFlowHint();
  syncQueuedJobsFromForm();
});
els.accountMobileInput?.addEventListener('input', () => {
  markAccountCustomIfEdited();
  refreshFullFlowHint();
  syncQueuedJobsFromForm();
});
els.accountOtpInput?.addEventListener('input', () => {
  markAccountCustomIfEdited();
  refreshFullFlowHint();
  syncQueuedJobsFromForm();
});
els.skipLaunch?.addEventListener('change', syncQueuedJobsFromForm);
els.runHandoff?.addEventListener('change', syncQueuedJobsFromForm);
els.searchInput.addEventListener('input', () => {
  state.catalogPage = 1;
  renderCatalog();
});
els.catalogPageSize.addEventListener('change', () => {
  state.catalogPageSize = Number(els.catalogPageSize.value) || 8;
  state.catalogPage = 1;
  renderCatalog();
});
els.reportPageSize.addEventListener('change', () => {
  state.reportPageSize = Number(els.reportPageSize.value) || 10;
  state.reportPage = 1;
  loadReports(1);
});
els.startBtn.addEventListener('click', startRun);
els.addJobBtn.addEventListener('click', addSelectedToQueue);
els.clearJobsBtn.addEventListener('click', () => {
  if (state.running) return;
  state.jobs = [];
  renderJobs();
});
els.stopBtn.addEventListener('click', () => stopRun());
els.refreshReports.addEventListener('click', () => loadReports(state.reportPage));
els.l5PageSize?.addEventListener('change', () => {
  state.l5PageSize = Number(els.l5PageSize.value) || 10;
  state.l5Page = 1;
  loadL5Reports(1);
});
els.refreshL5?.addEventListener('click', () => loadL5Reports(state.l5Page));
els.refreshDevices.addEventListener('click', () => loadDevices());
els.selectAllDevices.addEventListener('click', () => {
  for (const d of state.devices) {
    if (d.usable) state.selectedDeviceIds.add(d.udid);
  }
  renderDevices();
});

els.recordMode.addEventListener('change', syncRecordModeUi);
els.recordStartBtn.addEventListener('click', startRecordSession);
els.recordStopBtn.addEventListener('click', stopRecordSession);
els.recordGenerateBtn.addEventListener('click', generateRecordArtifacts);
els.recordAddStepBtn.addEventListener('click', addRecordStep);
els.recordNewPageBtn.addEventListener('click', addRecordPage);
els.recordShotBtn.addEventListener('click', captureRecordShot);
els.recordSuggestBtn.addEventListener('click', suggestRecordVerify);
document.querySelectorAll('.pipeline .pipe-item').forEach((el) => {
  el.addEventListener('click', () => {
    if (el.dataset.pipe) setPipelineStep(el.dataset.pipe);
  });
});
syncRecordModeUi();

loadCatalog();
loadDevices();
loadReports(1);
loadL5Reports(1);
connectEvents();
setInterval(pollState, 1500);
setInterval(loadDevices, 15000);
pollState();
renderPanel();
renderJobs();
