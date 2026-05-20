// app.js — Stratechna Cronómetros (Tauri)
// Adaptado da extensão Chrome — substitui chrome.* por Tauri APIs

const API_BASE = 'https://portal.stratechna.com/api'
const COR_WG   = '#7977BB'
const COR_MB_L = '#4CAF8A'
const COR_PROJ = '#E8820C'
const COR_RED  = '#880000'

// ─── Tauri APIs (carregadas após DOMContentLoaded) ────────────────────────────
let tauriStore   = null   // @tauri-apps/plugin-store
let tauriInvoke  = null   // window.__TAURI__.core.invoke
let tauriOpen    = null   // @tauri-apps/plugin-shell openUrl
let tauriNotify  = null   // @tauri-apps/plugin-notification

async function initTauri() {
  const { Store } = await import('https://unpkg.com/@tauri-apps/plugin-store@2/dist/index.js').catch(() => ({}))
  tauriInvoke = window.__TAURI__?.core?.invoke
  tauriOpen   = window.__TAURI__?.shell?.open

  // Store simples via localStorage como fallback robusto
  // (Tauri store persiste entre sessões mas localStorage funciona dentro da WebView)
  tauriStore = {
    async get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
    async set(key, val) { localStorage.setItem(key, JSON.stringify(val)) },
    async delete(key) { localStorage.removeItem(key) },
  }
}

// ─── Persistência de tokens e timers ─────────────────────────────────────────
async function storeGet(key) { return tauriStore ? tauriStore.get(key) : null }
async function storeSet(key, val) { if (tauriStore) await tauriStore.set(key, val) }
async function storeDel(key) { if (tauriStore) await tauriStore.delete(key) }

// ─── Token refresh ────────────────────────────────────────────────────────────
async function getValidToken() {
  const token        = await storeGet('auth_token')
  const refreshToken = await storeGet('refresh_token')
  if (!token) throw new Error('Sessão expirada — inicia sessão novamente')

  try {
    const payload    = JSON.parse(atob(token.split('.')[1]))
    const expiresAt  = payload.exp * 1000
    const cincoMin   = 5 * 60 * 1000
    if (expiresAt - Date.now() > cincoMin) return token

    if (!refreshToken) throw new Error('Sessão expirada — inicia sessão novamente')
    const r = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })
    if (!r.ok) {
      await storeSet('auth_token', null)
      await storeSet('refresh_token', null)
      throw new Error('Sessão expirada — inicia sessão novamente')
    }
    const json = await r.json()
    await storeSet('auth_token', json.access_token)
    await storeSet('refresh_token', json.refresh_token || refreshToken)
    return json.access_token
  } catch (e) {
    if (e.message.includes('Sessão expirada')) throw e
    throw new Error('Token inválido — inicia sessão novamente')
  }
}

// ─── Notificação nativa ───────────────────────────────────────────────────────
async function notifyNative(title, body) {
  try {
    if (window.__TAURI__?.notification) {
      await window.__TAURI__.notification.sendNotification({ title, body })
    } else {
      new Notification(title, { body })
    }
  } catch { /* ignora se não tiver permissão */ }
}

// ─── Update tray label (macOS: texto inline; Windows: tooltip) ────────────────
async function updateTrayLabel(label) {
  try {
    if (tauriInvoke) await tauriInvoke('update_tray_label', { label })
  } catch { /* ignora em dev */ }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────
function parseDuracao(str) {
  if (!str) return null
  const s = str.trim().replace(',', '.')
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)?\s*m?$/)
  if (hm) { const h = parseFloat(hm[1]); const m = hm[2] ? parseInt(hm[2]) : 0; return Math.round((h + m/60)*100)/100 }
  const onlyMin = s.match(/^(\d+)\s*m$/)
  if (onlyMin) return Math.round(parseInt(onlyMin[1])/60*100)/100
  const onlyH = s.match(/^(\d+(?:\.\d+)?)\s*h?$/)
  if (onlyH) return parseFloat(onlyH[1])
  return null
}
function formatTime(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
function segsParaHoras(secs) { return Math.round(secs / 36) / 100 }
function getSecs(timer) {
  return timer.elapsed + (timer.running ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0)
}
function timerCor(timer) {
  if (timer.sistema === 'projects') return COR_PROJ
  if (timer.dept === 'mbontime') return COR_MB_L
  return COR_WG
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function toast(text, tipo = 'success') {
  const el = document.createElement('div')
  el.className = `toast ${tipo}`
  el.textContent = text
  document.getElementById('toasts').appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

// ─── Estado ───────────────────────────────────────────────────────────────────
let state = {
  authenticated: false,
  timers: [],
  view: 'loading',
  sistema: 'desk',
  items: [],
  tickHandle: null,
  pendingSubmit: null,
  selectingTarefa: null,
  tarefas: [],
  manualStep: 'item',
  manualItem: null,
  manualTarefas: [],
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initTauri()

  const token  = await storeGet('auth_token')
  const timers = await storeGet('timers') || []
  state.authenticated = !!token
  state.timers = timers

  if (!state.authenticated) showLogin()
  else showTimers()

  bindEvents()
  startTick()
})

// ─── Views ────────────────────────────────────────────────────────────────────
function setView(view) {
  state.view = view
  ;['login','timers','new','tarefas','manual','ticket'].forEach(v => {
    const el = document.getElementById(`view-${v}`)
    if (el) el.style.display = v === view ? 'block' : 'none'
  })
  document.getElementById('footer-new').style.display  = view === 'timers' ? 'block' : 'none'
  document.getElementById('footer-back').style.display = (view === 'new' || view === 'tarefas' || view === 'ticket') ? 'block' : 'none'
  document.getElementById('btn-logout').style.display  = view !== 'login' ? 'flex' : 'none'
}

function showLogin() { setView('login'); document.getElementById('header-sub').textContent = 'Inicia sessão para continuar' }
function showTimers() { state.selectingTarefa = null; setView('timers'); renderTimers(true) }
function showNew() { setView('new'); document.getElementById('search-input').value = ''; loadItems() }
function showManual() {
  state.manualStep = 'item'; state.manualItem = null; state.manualTarefas = []; state.sistema = 'desk'
  setView('manual')
  document.getElementById('footer-back').style.display = 'block'
  document.getElementById('footer-new').style.display = 'none'
  setTimeout(() => renderManual(), 50)
}

// ─── Novo Ticket ──────────────────────────────────────────────────────────────
const MBONTIME_TAREFAS = [
  "Secretariado - Gestão de Agenda virtual",
  "Secretariado - Organização e coordenação de Viagens",
  "Secretariado - Apoio Administrativo",
  "Secretariado - Comunicação e Correspondência",
  "Secretariado - Atendimento com Acolhimento",
  "Secretariado - Organização de Documentos",
  "Secretariado - Gestão de Despesas",
  "Secretariado - Criação e gestão de bases de dados",
  "Secretariado - Assistência às Relações Laborais",
  "Secretariado - Ligação entre Departamentos",
  "Secretariado - Recrutamento seleção e contratação",
  "Secretariado - Apoio ao processamento salarial",
  "Secretariado - Participação em Reunião",
  "Secretariado - Redação de documentos formais",
  "Assessoria - Assessoria Estratégica",
  "Assessoria - Assessoria Financeira",
  "Assessoria - Assessoria de Atendimento ao Cliente",
  "Assessoria - Assessoria em Recursos Humanos",
  "Assessoria - Assessoria Informática - Apoio elementar",
  "Assessoria - Assessoria em Processos e Operações",
  "Assessoria - Assessoria Doméstica - só para Particulares",
  "Assessoria - Assessoria em Sustentabilidade e Responsabilidade Social",
  "Assessoria - Criação e gestão de bases de dados",
  "Outras tarefas",
]

let ticketState = {
  prioridade: 'Low',
  departamentos: [],
}

async function showNovoTicket() {
  setView('ticket')
  document.getElementById('footer-back').style.display = 'block'
  document.getElementById('footer-new').style.display = 'none'

  // Mostrar form, esconder sucesso
  document.getElementById('ticket-success').style.display = 'none'
  document.getElementById('ticket-form').style.display = 'flex'

  // Reset form
  document.getElementById('ticket-assunto').value = ''
  document.getElementById('ticket-descricao').value = ''
  document.getElementById('assunto-count').textContent = '0'
  document.getElementById('desc-count').textContent = '0'
  document.getElementById('err-dept').style.display = 'none'
  document.getElementById('err-assunto').style.display = 'none'
  document.getElementById('err-desc').style.display = 'none'
  document.getElementById('err-tarefa') && (document.getElementById('err-tarefa').style.display = 'none')
  ticketState.prioridade = 'Low'
  document.querySelectorAll('.prio-btn').forEach(b => {
    b.className = 'prio-btn' + (b.dataset.prio === 'Low' ? ' active-low' : '')
  })
  // Esconder campo tarefa por defeito
  const tarefaSection = document.getElementById('tarefa-section')
  if (tarefaSection) tarefaSection.style.display = 'none'
  const tarefaSel = document.getElementById('ticket-tarefa')
  if (tarefaSel) tarefaSel.value = 

  // Carregar departamentos se ainda nao carregados
  await loadDepartamentos()
}

async function loadDepartamentos() {
  const sel = document.getElementById('ticket-dept')
  if (ticketState.departamentos.length > 0) {
    renderDeptSelect(ticketState.departamentos)
    return
  }
  sel.innerHTML = '<option value="">A carregar...</option>'
  try {
    const token = await getValidToken()
    const r = await fetch(`${API_BASE}/desk/departamentos`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error('Erro')
    const depts = await r.json()
    ticketState.departamentos = depts
    renderDeptSelect(depts)
  } catch (e) {
    sel.innerHTML = '<option value="">Erro ao carregar departamentos</option>'
  }
}

function renderDeptSelect(depts) {
  const sel = document.getElementById('ticket-dept')
  sel.innerHTML = '<option value="">Selecciona o departamento...</option>' +
    depts.map(d => `<option value="${esc(d.slug)}">${esc(d.nome)}</option>`).join('')
}

function bindTicketEvents() {
  // Limpar erro tarefa ao seleccionar
  document.getElementById('ticket-tarefa')?.addEventListener('change', e => {
    if (e.target.value) document.getElementById('err-tarefa').style.display = 'none'
  })

  // Contador de caracteres
  document.getElementById('ticket-assunto')?.addEventListener('input', e => {
    document.getElementById('assunto-count').textContent = e.target.value.length
    if (e.target.value.trim()) document.getElementById('err-assunto').style.display = 'none'
  })
  document.getElementById('ticket-descricao')?.addEventListener('input', e => {
    document.getElementById('desc-count').textContent = e.target.value.length
    if (e.target.value.trim()) document.getElementById('err-desc').style.display = 'none'
  })
  document.getElementById('ticket-dept')?.addEventListener('change', e => {
    if (e.target.value) document.getElementById('err-dept').style.display = 'none'
    // Mostrar campo tarefa apenas para MBontime
    const tarefaSection = document.getElementById('tarefa-section')
    if (tarefaSection) {
      const isMB = e.target.value === 'mbontime'
      tarefaSection.style.display = isMB ? 'block' : 'none'
      if (isMB) {
        const sel = document.getElementById('ticket-tarefa')
        if (sel && sel.options.length <= 1) {
          sel.innerHTML = '<option value="">Selecciona a tarefa...</option>' +
            MBONTIME_TAREFAS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
        }
      }
    }
  })

  // Prioridade
  document.querySelectorAll('.prio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ticketState.prioridade = btn.dataset.prio
      const classMap = { Low: 'active-low', Medium: 'active-medium', High: 'active-high', Urgent: 'active-urgent' }
      document.querySelectorAll('.prio-btn').forEach(b => {
        b.className = 'prio-btn' + (b.dataset.prio === btn.dataset.prio ? ' ' + classMap[btn.dataset.prio] : '')
      })
    })
  })

  // Submit
  document.getElementById('btn-ticket-submit')?.addEventListener('click', async () => {
    const dept = document.getElementById('ticket-dept')?.value || ''
    const assunto = document.getElementById('ticket-assunto')?.value?.trim() || ''
    const descricao = document.getElementById('ticket-descricao')?.value?.trim() || ''

    const tarefa = dept === 'mbontime' ? (document.getElementById('ticket-tarefa')?.value || '') : null
    let hasErr = false
    if (!dept) { document.getElementById('err-dept').style.display = 'block'; hasErr = true }
    if (!assunto) { document.getElementById('err-assunto').style.display = 'block'; hasErr = true }
    if (!descricao) { document.getElementById('err-desc').style.display = 'block'; hasErr = true }
    if (dept === 'mbontime' && !tarefa) { document.getElementById('err-tarefa').style.display = 'block'; hasErr = true }
    if (hasErr) return

    const btn = document.getElementById('btn-ticket-submit')
    btn.disabled = true; btn.textContent = 'A submeter...'

    try {
      const token = await getValidToken()
      const r = await fetch(`${API_BASE}/desk/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          assunto,
          descricao,
          departamento_slug: dept,
          prioridade: ticketState.prioridade,
          ...(tarefa ? { tarefa } : {}),
        })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`)

      // Mostrar sucesso
      document.getElementById('ticket-form').style.display = 'none'
      document.getElementById('ticket-success').style.display = 'block'
      const num = data.numero ? `#${data.numero}` : ''
      document.getElementById('ticket-num-created').textContent = num
      toast(`✓ Ticket ${num} criado com sucesso`)
    } catch (e) {
      toast(`Erro: ${e.message}`, 'error')
    } finally {
      btn.disabled = false; btn.textContent = 'Submeter Ticket'
    }
  })

  // Criar outro ticket
  document.getElementById('btn-ticket-outro')?.addEventListener('click', () => {
    showNovoTicket()
  })
}
function showTarefas(timerId, projectId, projectName) {
  state.selectingTarefa = { timerId, projectId, projectName }
  setView('tarefas')
  document.getElementById('tarefas-title').textContent = projectName || 'Seleccionar tarefa'
  loadTarefas(projectId)
}

// ─── Render timers ────────────────────────────────────────────────────────────
function renderTimers(forceRebuild = false) {
  if (state.view !== 'timers') return
  const container = document.getElementById('timers-list')
  const empty     = document.getElementById('empty-state')
  const running   = state.timers.filter(t => t.running).length
  const total     = state.timers.length

  document.getElementById('header-sub').textContent =
    total === 0 ? 'Nenhum cronómetro activo' : `${running} a correr · ${total} total`

  // Actualiza tray label com o timer mais antigo a correr
  const runningTimers = state.timers.filter(t => t.running)
  if (runningTimers.length > 0) {
    const secs = getSecs(runningTimers[0])
    const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60), s = secs%60
    const label = h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    updateTrayLabel(label)
  } else {
    updateTrayLabel('')
  }

  if (total === 0) { container.innerHTML = ''; empty.style.display = 'block'; return }
  empty.style.display = 'none'

  const existingCards = container.querySelectorAll('.timer-card')
  if (!forceRebuild && existingCards.length === state.timers.length) {
    state.timers.forEach((timer, i) => {
      const card = existingCards[i]
      if (!card) return
      const secs = getSecs(timer)
      const cor  = timerCor(timer)
      const h    = segsParaHoras(secs)
      const timeEl = card.querySelector('.timer-time')
      if (timeEl) timeEl.textContent = formatTime(secs)
      const btnFree = card.querySelector('.btn-free')
      const btnBill = card.querySelector('.btn-bill')
      if (btnFree) btnFree.querySelector('.btn-horas').textContent = `Grátis ${h}h`
      if (btnBill) btnBill.querySelector('.btn-horas').textContent = `Fat. ${h}h`
      const toggleBtn = card.querySelector('[data-toggle]')
      if (toggleBtn) {
        if (timer.running) {
          toggleBtn.className = 'btn-timer btn-toggle-pause'
          toggleBtn.querySelector('.toggle-label').textContent = 'Pausar'
          toggleBtn.style.color = ''; toggleBtn.style.borderColor = ''
        } else {
          toggleBtn.className = 'btn-timer btn-toggle-run'
          toggleBtn.querySelector('.toggle-label').textContent = 'Retomar'
          toggleBtn.style.color = cor; toggleBtn.style.borderColor = cor + '44'
        }
      }
    })
    return
  }

  container.innerHTML = state.timers.map(timer => {
    const secs  = getSecs(timer)
    const cor   = timerCor(timer)
    const h     = segsParaHoras(secs)
    const badge = timer.sistema === 'projects' ? '🗂 PROJECTS'
      : timer.dept === 'mbontime' ? '🏢 MBONTIME' : '💼 WEBGATE'
    const ref   = timer.sistema === 'desk' ? `Ticket #${timer.ticketRef}` : `Projecto: ${timer.ticketRef}`
    const tarefaHtml = timer.sistema === 'projects' ? `
      <div class="tarefa-row">
        ${timer.taskId
          ? `<div class="tarefa-selected">
               <svg viewBox="0 0 24 24" fill="none" stroke="#4CAF8A" stroke-width="2.5" style="width:11px;height:11px;flex-shrink:0"><polyline points="20,6 9,17 4,12"/></svg>
               <span style="color:#4CAF8A;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(timer.taskName_tarefa)}</span>
               <button class="btn-change-tarefa" data-timer="${timer.id}" data-project="${timer.ticketRef}" data-name="${esc(timer.taskName)}">alterar</button>
             </div>`
          : `<button class="btn-sel-tarefa" data-timer="${timer.id}" data-project="${timer.ticketRef}" data-name="${esc(timer.taskName)}">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
               Seleccionar tarefa (opcional)
             </button>`}
      </div>` : ''
    return `
      <div class="timer-card" data-id="${timer.id}">
        <div class="timer-top">
          <span class="timer-badge" style="background:${cor}22;color:${cor};border:1px solid ${cor}44">
            ${badge}${timer.running ? ' <span class="pulse-dot"></span>' : ''}
          </span>
        </div>
        <div class="timer-title">${esc(timer.taskName)}</div>
        <div class="timer-ref">${esc(ref)}</div>
        <div class="timer-time" style="color:${cor}">${formatTime(secs)}</div>
        ${tarefaHtml}
        <div class="desc-area">
          <div class="desc-label">Descrição *</div>
          <textarea class="desc-input${timer.descErro ? ' error' : ''}" data-desc="${timer.id}"
            placeholder="Descreva o trabalho realizado..." rows="3">${esc(timer.descricao || '')}</textarea>
          ${timer.descErro ? '<div class="desc-error">A descrição é obrigatória para submeter.</div>' : ''}
        </div>
        <div class="timer-actions">
          <button class="btn-timer ${timer.running ? 'btn-toggle-pause' : 'btn-toggle-run'}"
            data-toggle="${timer.id}" style="${timer.running ? '' : `color:${cor};border-color:${cor}44`}">
            <span class="toggle-icon">${timer.running
              ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
              : `<svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px"><polygon points="5,3 19,12 5,21"/></svg>`}</span>
            <span class="toggle-label">${timer.running ? 'Pausar' : 'Retomar'}</span>
          </button>
          <button class="btn-timer btn-free" data-submit="${timer.id}" data-billable="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
            <span class="btn-horas">Grátis ${h}h</span>
          </button>
          <button class="btn-timer btn-bill" data-submit="${timer.id}" data-billable="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
            <span class="btn-horas">Fat. ${h}h</span>
          </button>
        </div>
        <button class="btn-discard" data-discard="${timer.id}" title="Descartar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`
  }).join('')

  container.querySelectorAll('textarea[data-desc]').forEach(el => {
    el.addEventListener('input', async e => {
      const id = parseInt(e.target.dataset.desc)
      const timer = state.timers.find(t => t.id === id)
      if (timer) { timer.descricao = e.target.value; await persistTimers() }
    })
  })
  container.querySelectorAll('.btn-sel-tarefa, .btn-change-tarefa').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      showTarefas(parseInt(btn.dataset.timer), btn.dataset.project, btn.dataset.name)
    })
  })
}

// ─── Persistência de timers ───────────────────────────────────────────────────
async function persistTimers() {
  await storeSet('timers', state.timers)
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
function startTick() {
  if (state.tickHandle) clearInterval(state.tickHandle)
  state.tickHandle = setInterval(() => {
    if (state.view === 'timers' && state.timers.some(t => t.running)) renderTimers(false)
  }, 1000)
}

// ─── Load items ───────────────────────────────────────────────────────────────
async function loadItems() {
  const list = document.getElementById('new-items-list')
  list.innerHTML = `<div class="loading-inline"><div class="spinner-sm"></div>A carregar...</div>`
  try {
    const token = await getValidToken()
    const url   = state.sistema === 'desk'
      ? `${API_BASE}/desk/tickets?limit=50&status=open`
      : `${API_BASE}/projects/projetos`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error('Erro ao carregar')
    const json = await r.json()
    state.items = json.tickets || json.projetos || []
    renderItems()
  } catch (e) {
    list.innerHTML = `<div class="inline-error">Erro: ${esc(e.message)}</div>`
  }
}

function renderItems(search = '') {
  const list  = document.getElementById('new-items-list')
  const q     = search.toLowerCase()
  const isProj = state.sistema === 'projects'
  const filtered = state.items.filter(item => {
    const nome = isProj ? (item.name||item.nome||'') : (item.assunto||item.subject||item.titulo||'')
    return !q || nome.toLowerCase().includes(q)
  })
  if (!filtered.length) { list.innerHTML = `<div class="loading-inline" style="color:var(--muted)">Nenhum resultado</div>`; return }
  list.innerHTML = `<div class="item-list">${filtered.map(item => {
    const nome  = isProj ? (item.name||item.nome||'Sem nome') : (item.assunto||item.subject||item.titulo||'Sem título')
    const ref   = item.ticketNumber||item.id||''
    const dept  = item.dept_slug||item.departamento?.toLowerCase()||''
    const deptColor = dept==='mbontime' ? COR_MB_L : isProj ? COR_PROJ : COR_WG
    return `<button class="item-btn${isProj?' proj':''}" data-item='${JSON.stringify({
      taskName: nome, ticketRef: ref,
      dept: dept||(isProj?'projects':'webgate'),
      deptLabel: item.departamento||item.estado||(isProj?'Projecto':''),
      sistema: state.sistema, taskId: null,
    }).replace(/'/g,"&#39;")}'>
      <span class="item-name">${esc(nome)}</span>
      <span class="item-meta"><span style="color:${deptColor};font-weight:600;font-size:10px">${esc(item.departamento||item.estado||(isProj?'Projecto':''))}</span><span>#${esc(ref)}</span></span>
    </button>`
  }).join('')}</div>`
  list.querySelectorAll('.item-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = JSON.parse(btn.dataset.item.replace(/&#39;/g,"'"))
      const newTimer = {
        id: Date.now(), taskName: item.taskName, ticketRef: item.ticketRef,
        dept: item.dept, sistema: item.sistema, deptLabel: item.deptLabel,
        running: true, startedAt: Date.now(), elapsed: 0,
        descricao: '', taskId: null, fecharTarefa: false,
      }
      state.timers.push(newTimer)
      await persistTimers()
      if (item.sistema === 'projects') {
        showTimers()
        setTimeout(() => showTarefas(newTimer.id, item.ticketRef, item.taskName), 50)
      } else {
        showTimers()
        toast(`▶ "${item.taskName.slice(0,30)}" iniciado`)
      }
    })
  })
}

// ─── Tarefas ──────────────────────────────────────────────────────────────────
async function loadTarefas(projectId) {
  const list = document.getElementById('tarefas-list')
  list.innerHTML = `<div class="loading-inline"><div class="spinner-sm"></div>A carregar tarefas...</div>`
  try {
    const token = await getValidToken()
    const r = await fetch(`${API_BASE}/projects/projetos/${projectId}/tarefas`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error('Erro')
    const json = await r.json()
    state.tarefas = (json.tarefas || []).sort((a,b) => (a.created_time_long||0)-(b.created_time_long||0))
    renderTarefas()
  } catch (e) {
    list.innerHTML = `<div class="inline-error">Erro: ${esc(e.message)}</div>`
  }
}

function renderTarefas() {
  const list = document.getElementById('tarefas-list')
  if (!state.tarefas.length) {
    list.innerHTML = `<div class="loading-inline" style="flex-direction:column;gap:10px;color:var(--muted)">
      <span>Nenhuma tarefa encontrada</span>
      <button id="btn-skip-t" style="background:var(--bg3);border:1px solid var(--border2);color:var(--muted);border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px">Continuar sem tarefa</button>
    </div>`
    document.getElementById('btn-skip-t')?.addEventListener('click', () => { showTimers(); toast('Timer iniciado') })
    return
  }
  list.innerHTML = `<div class="item-list">
    <button class="item-btn" id="btn-skip-t2" style="border-style:dashed">
      <span class="item-name" style="color:var(--muted)">Continuar sem seleccionar tarefa</span>
    </button>
    ${state.tarefas.map(t => `
      <button class="item-btn proj" data-tid="${esc(t.id)}" data-tname="${esc(t.name||t.label||'')}">
        <span class="item-name">${esc(t.name||t.label||'Sem nome')}</span>
        ${t.status ? `<span class="item-meta"><span style="color:var(--proj);font-size:10px">${esc(t.status)}</span></span>` : ''}
      </button>`).join('')}
  </div>`
  document.getElementById('btn-skip-t2')?.addEventListener('click', () => showTimers())
  list.querySelectorAll('[data-tid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { timerId } = state.selectingTarefa
      const taskId = btn.dataset.tid, taskName = btn.dataset.tname
      state.timers = state.timers.map(t => t.id === timerId ? { ...t, taskId, taskName_tarefa: taskName } : t)
      await persistTimers()
      showTimers()
      toast(`Tarefa "${taskName.slice(0,25)}" associada`)
    })
  })
}

// ─── Render registo manual ────────────────────────────────────────────────────
function renderManual() {
  if (state.view !== 'manual') return
  const container = document.getElementById('view-manual')
  if (!container) return

  if (state.manualStep === 'item') {
    container.innerHTML = `
      <div style="padding:14px 14px 8px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Registo manual — seleccionar</div>
        <div class="tab-switch" style="margin-bottom:12px">
          <button class="tab-btn ${state.sistema==='desk'?'active-wg':''}" id="rm-tab-desk">💼 Zoho Desk</button>
          <button class="tab-btn ${state.sistema==='projects'?'active-proj':''}" id="rm-tab-proj">🗂 Zoho Projects</button>
        </div>
        <div class="search-box" style="margin-bottom:8px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="rm-search" placeholder="Pesquisar..." />
        </div>
      </div>
      <div id="rm-items-list" style="padding:8px 14px 14px"></div>`
    document.getElementById('rm-tab-desk')?.addEventListener('click', () => { state.sistema='desk'; renderManual(); loadManualItems() })
    document.getElementById('rm-tab-proj')?.addEventListener('click', () => { state.sistema='projects'; renderManual(); loadManualItems() })
    let st = null
    document.getElementById('rm-search')?.addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => renderManualItems(e.target.value), 200) })
    loadManualItems()
    return
  }

  if (state.manualStep === 'form') {
    const hoje = new Date().toISOString().slice(0, 10)
    container.innerHTML = `
      <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Registo manual</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(state.manualItem?.taskName||'')}</div>
          <button id="rm-change" style="background:none;border:none;color:var(--muted);font-size:10px;cursor:pointer;text-decoration:underline;flex-shrink:0;font-family:var(--sans)">alterar</button>
        </div>
      </div>
      <div style="padding:12px 14px;display:flex;flex-direction:column;gap:12px">
        ${state.manualItem?.sistema==='projects'&&state.manualTarefas.length>0?`
        <div>
          <div class="desc-label">Tarefa (opcional)</div>
          <input list="rm-tarefas-list" id="rm-tarefa-input" placeholder="— Seleccionar tarefa —"
            style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border2);border-radius:5px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;user-select:text;-webkit-user-select:text"/>
          <datalist id="rm-tarefas-list">${state.manualTarefas.map(t=>`<option value="${esc(t.name||t.label||'')}"/>`).join('')}</datalist>
        </div>`:''}
        <div>
          <div class="desc-label">Data *</div>
          <input type="date" id="rm-data" value="${hoje}"
            style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border2);border-radius:5px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;color-scheme:dark;user-select:text;-webkit-user-select:text"/>
        </div>
        <div>
          <div class="desc-label">Duração * <span style="font-weight:400;text-transform:none;color:#555;font-size:10px">ex: 1h30m, 1,5h, 90m</span></div>
          <input type="text" id="rm-duracao" placeholder="ex: 1h30m ou 1,5h ou 90m"
            style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border2);border-radius:5px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;user-select:text;-webkit-user-select:text"/>
          <div id="rm-duracao-hint" style="font-size:10px;margin-top:2px;color:var(--success);display:none"></div>
          <div id="rm-duracao-erro" style="font-size:10px;margin-top:2px;color:var(--error);display:none"></div>
        </div>
        <div>
          <div class="desc-label">Descrição *</div>
          <textarea id="rm-desc" placeholder="Descreva o trabalho realizado..." rows="3"
            style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border2);border-radius:5px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;resize:vertical;user-select:text;-webkit-user-select:text"></textarea>
          <div id="rm-desc-erro" style="font-size:10px;margin-top:2px;color:var(--error);display:none">A descrição é obrigatória.</div>
        </div>
        <div class="timer-actions">
          <button class="btn-timer btn-free" id="rm-btn-free">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
            <span>Grátis</span>
          </button>
          <button class="btn-timer btn-bill" id="rm-btn-bill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
            <span>Faturado</span>
          </button>
        </div>
      </div>`
    document.getElementById('rm-change')?.addEventListener('click', () => { state.manualStep='item'; renderManual() })
    document.getElementById('rm-duracao')?.addEventListener('input', e => {
      const h = parseDuracao(e.target.value)
      const hint = document.getElementById('rm-duracao-hint'), erro = document.getElementById('rm-duracao-erro')
      if (h&&h>0&&h<=24) { hint.textContent=`= ${h}h`; hint.style.display='block'; erro.style.display='none' }
      else hint.style.display='none'
    })
    const doSubmit = async (billable) => {
      const horas = parseDuracao(document.getElementById('rm-duracao')?.value||'')
      const erroD = document.getElementById('rm-duracao-erro'), hint = document.getElementById('rm-duracao-hint')
      if (!horas||horas<=0||horas>24) { erroD.textContent='Duração inválida. Ex: 1h30m, 1,5h, 90m'; erroD.style.display='block'; hint.style.display='none'; return }
      erroD.style.display='none'
      const desc = document.getElementById('rm-desc')?.value?.trim()||''
      const erroDesc = document.getElementById('rm-desc-erro')
      if (!desc) { erroDesc.style.display='block'; return }
      erroDesc.style.display='none'
      const dataStr = document.getElementById('rm-data')?.value||''
      const tarefaInput = document.getElementById('rm-tarefa-input')?.value||''
      const tarefa = state.manualTarefas.find(t=>(t.name||t.label||'')===tarefaInput)
      const taskId = tarefa?tarefa.id:null
      const btnF = document.getElementById('rm-btn-free'), btnB = document.getElementById('rm-btn-bill')
      if(btnF) btnF.disabled=true; if(btnB) btnB.disabled=true
      try {
        const token = await getValidToken()
        const headers = { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }
        const body = { description: desc, billable }
        if (dataStr) body.date = dataStr
        if (state.manualItem.sistema === 'desk') {
          body.hours_spent = horas
          const r = await fetch(`${API_BASE}/desk/tickets/${state.manualItem.ticketRef}/time-entries`, { method:'POST', headers, body:JSON.stringify(body) })
          if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.detail||`HTTP ${r.status}`) }
        } else {
          body.hours = horas; body.task_id = taskId
          const r = await fetch(`${API_BASE}/projects/projetos/${state.manualItem.ticketRef}/time-entries`, { method:'POST', headers, body:JSON.stringify(body) })
          if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.detail||`HTTP ${r.status}`) }
        }
        await notifyNative('Stratechna — Tempo registado', `${horas}h registadas em "${(state.manualItem.taskName||'').slice(0,40)}"`)
        toast(`✓ ${horas}h registadas no Zoho`)
        showTimers()
      } catch(e) {
        toast(`Erro: ${e.message}`, 'error')
      } finally {
        if(btnF) btnF.disabled=false; if(btnB) btnB.disabled=false
      }
    }
    document.getElementById('rm-btn-free')?.addEventListener('click', () => doSubmit(false))
    document.getElementById('rm-btn-bill')?.addEventListener('click', () => doSubmit(true))
    return
  }
}

async function loadManualItems() {
  const list = document.getElementById('rm-items-list')
  if (!list) return
  list.innerHTML = `<div class="loading-inline"><div class="spinner-sm"></div>A carregar...</div>`
  try {
    const token = await getValidToken()
    const url = state.sistema==='desk' ? `${API_BASE}/desk/tickets?limit=50&status=open` : `${API_BASE}/projects/projetos`
    const r = await fetch(url, { headers: { Authorization:`Bearer ${token}` } })
    if (!r.ok) throw new Error('Erro')
    const json = await r.json()
    state.items = json.tickets||json.projetos||[]
    renderManualItems()
  } catch(e) { list.innerHTML = `<div class="inline-error">Erro: ${esc(e.message)}</div>` }
}

function renderManualItems(search='') {
  const list = document.getElementById('rm-items-list')
  if (!list) return
  const q = search.toLowerCase(), isProj = state.sistema==='projects'
  const filtered = state.items.filter(item => {
    const nome = isProj?(item.name||item.nome||''):(item.assunto||item.subject||item.titulo||'')
    return !q||nome.toLowerCase().includes(q)
  })
  if (!filtered.length) { list.innerHTML=`<div class="loading-inline" style="color:var(--muted)">Nenhum resultado</div>`; return }
  list.innerHTML = `<div class="item-list">${filtered.map(item => {
    const nome = isProj?(item.name||item.nome||'Sem nome'):(item.assunto||item.subject||item.titulo||'Sem título')
    const ref = item.ticketNumber||item.id||''
    const dept = item.dept_slug||item.departamento?.toLowerCase()||''
    const deptColor = dept==='mbontime'?COR_MB_L:isProj?COR_PROJ:COR_WG
    return `<button class="item-btn${isProj?' proj':''}" data-mitem='${JSON.stringify({
      taskName:nome, ticketRef:ref, dept:dept||(isProj?'projects':'webgate'), sistema:state.sistema
    }).replace(/'/g,"&#39;")}'>
      <span class="item-name">${esc(nome)}</span>
      <span class="item-meta"><span style="color:${deptColor};font-weight:600;font-size:10px">${esc(item.departamento||item.estado||(isProj?'Projecto':''))}</span><span>#${esc(ref)}</span></span>
    </button>`
  }).join('')}</div>`
  list.querySelectorAll('[data-mitem]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = JSON.parse(btn.dataset.mitem.replace(/&#39;/g,"'"))
      state.manualItem = item; state.manualStep = 'form'
      if (item.sistema==='projects') {
        try {
          const token = await getValidToken()
          const r = await fetch(`${API_BASE}/projects/projetos/${item.ticketRef}/tarefas`, { headers:{Authorization:`Bearer ${token}`} })
          const json = await r.json()
          state.manualTarefas = (json.tarefas||[]).sort((a,b)=>(a.created_time_long||0)-(b.created_time_long||0))
        } catch { state.manualTarefas=[] }
      } else { state.manualTarefas=[] }
      renderManual()
    })
  })
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(id, billable) {
  const timer = state.timers.find(t => t.id === id)
  if (!timer) return
  const desc = (timer.descricao||'').trim()
  if (!desc) {
    state.timers = state.timers.map(t => t.id===id ? {...t, descErro:true} : t)
    renderTimers(true); return
  }
  const secs = getSecs(timer), cor = timerCor(timer)
  state.pendingSubmit = { id, secs, billable }
  document.getElementById('modal-desc').innerHTML =
    `Confirma o registo de <strong style="color:${cor}">${formatTime(secs)} (${segsParaHoras(secs)}h)</strong> em:`
  document.getElementById('modal-task').innerHTML = `
    <div class="name">${esc(timer.taskName)}</div>
    ${timer.taskName_tarefa ? `<div class="ref" style="color:var(--proj)">↳ ${esc(timer.taskName_tarefa)}</div>` : ''}
    <div class="ref">${timer.sistema==='desk'?'Ticket':'Projecto'} #${esc(timer.ticketRef)}</div>
    <div class="desc">"${esc(desc.slice(0,80))}${desc.length>80?'…':''}"</div>`
  document.getElementById('modal-confirm').classList.add('open')
}

async function doSubmit(billable) {
  if (!state.pendingSubmit) return
  document.getElementById('modal-confirm').classList.remove('open')
  const { id } = state.pendingSubmit
  state.pendingSubmit = null
  const timer = state.timers.find(t => t.id === id)
  if (!timer) return
  try {
    const token = await getValidToken()
    const secs  = getSecs(timer)
    const horas = segsParaHoras(secs)
    const headers = { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }
    if (timer.sistema === 'desk') {
      const r = await fetch(`${API_BASE}/desk/tickets/${timer.ticketRef}/time-entries`, {
        method:'POST', headers, body:JSON.stringify({ hours_spent:horas, description:timer.descricao, billable })
      })
      if (!r.ok) { const e=await r.json().catch(()=>{}); throw new Error(e?.detail||`HTTP ${r.status}`) }
    } else {
      const r = await fetch(`${API_BASE}/projects/projetos/${timer.ticketRef}/time-entries`, {
        method:'POST', headers, body:JSON.stringify({ hours:horas, description:timer.descricao, task_id:timer.taskId, billable })
      })
      if (!r.ok) { const e=await r.json().catch(()=>{}); throw new Error(e?.detail||`HTTP ${r.status}`) }
      if (timer.fecharTarefa && timer.taskId) {
        await fetch(`${API_BASE}/projects/projetos/${timer.ticketRef}/tarefas/${timer.taskId}/fechar`, { method:'PATCH', headers }).catch(()=>{})
      }
    }
    state.timers = state.timers.filter(t => t.id !== id)
    await persistTimers()
    await notifyNative('Stratechna — Tempo registado', `${horas}h registadas em "${timer.taskName.slice(0,40)}"`)
    toast(`✓ ${horas}h registadas no Zoho`)
    renderTimers(true)
  } catch(e) {
    toast(`Erro: ${e.message}`, 'error')
  }
}

// ─── Eventos ──────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim()
    const pass  = document.getElementById('login-password').value
    const errEl = document.getElementById('login-error')
    const btn   = document.getElementById('btn-login')
    errEl.style.display = 'none'; btn.disabled=true; btn.textContent='A entrar...'
    try {
      const r = await fetch(`${API_BASE}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email, password:pass}) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail||'Credenciais inválidas')
      const token = data.access_token||data.token
      if (!token) throw new Error('Token não recebido')
      await storeSet('auth_token', token)
      await storeSet('refresh_token', data.refresh_token||null)
      await storeSet('timers', state.timers)
      state.authenticated = true
      showTimers()
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display='block'
    } finally { btn.disabled=false; btn.textContent='Entrar' }
  })
  document.getElementById('login-password').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('btn-login').click() })
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await storeSet('auth_token', null); await storeSet('refresh_token', null); await storeSet('timers', [])
    state.authenticated=false; state.timers=[]; showLogin()
  })
  document.getElementById('btn-open-portal').addEventListener('click', () => {
    if (window.__TAURI__?.shell) window.__TAURI__.shell.open('https://portal.stratechna.com/cronometros')
    else window.open('https://portal.stratechna.com/cronometros', '_blank')
  })
  document.getElementById('link-portal')?.addEventListener('click', () => {
    if (window.__TAURI__?.shell) window.__TAURI__.shell.open('https://portal.stratechna.com')
    else window.open('https://portal.stratechna.com', '_blank')
  })
  document.getElementById('btn-new-timer').addEventListener('click', showNew)
  document.getElementById('btn-manual-timer').addEventListener('click', showManual)
  document.getElementById('btn-novo-ticket').addEventListener('click', showNovoTicket)
  document.getElementById('btn-back').addEventListener('click', () => {
    // Se estiver no ticket, voltar aos timers
    if (state.view === 'ticket') { showTimers(); return }
    showTimers()
  })
  bindTicketEvents()
  document.getElementById('tab-desk').addEventListener('click', () => {
    state.sistema='desk'
    document.getElementById('tab-desk').className='tab-btn active-wg'
    document.getElementById('tab-projects').className='tab-btn'
    document.getElementById('search-input').value=''; loadItems()
  })
  document.getElementById('tab-projects').addEventListener('click', () => {
    state.sistema='projects'
    document.getElementById('tab-projects').className='tab-btn active-proj'
    document.getElementById('tab-desk').className='tab-btn'
    document.getElementById('search-input').value=''; loadItems()
  })
  let st = null
  document.getElementById('search-input').addEventListener('input', e => { clearTimeout(st); st=setTimeout(()=>renderItems(e.target.value),200) })
  document.getElementById('timers-list').addEventListener('click', async e => {
    const toggleBtn  = e.target.closest('[data-toggle]')
    const submitBtn  = e.target.closest('[data-submit]')
    const discardBtn = e.target.closest('[data-discard]')
    if (toggleBtn) {
      const id = parseInt(toggleBtn.dataset.toggle)
      state.timers = state.timers.map(t => {
        if (t.id!==id) return t
        if (t.running) return {...t, running:false, elapsed:t.elapsed+Math.floor((Date.now()-t.startedAt)/1000)}
        return {...t, running:true, startedAt:Date.now()}
      })
      await persistTimers(); renderTimers(false)
    }
    if (submitBtn) openModal(parseInt(submitBtn.dataset.submit), submitBtn.dataset.billable==='true')
    if (discardBtn) {
      const id = parseInt(discardBtn.dataset.discard)
      if (confirm('Descartar cronómetro? O tempo não será registado.')) {
        state.timers = state.timers.filter(t => t.id!==id)
        await persistTimers(); renderTimers(true)
      }
    }
  })
  document.getElementById('modal-cancel').addEventListener('click', () => { document.getElementById('modal-confirm').classList.remove('open'); state.pendingSubmit=null })
  document.getElementById('modal-free').addEventListener('click', () => doSubmit(false))
  document.getElementById('modal-bill').addEventListener('click', () => doSubmit(true))
}
