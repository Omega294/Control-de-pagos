// State Management
const STATE_KEY = 'softball_tournament_data';

const defaultState = {
    baseCostUSD: 100,
    currentRateEurBs: 45.0,
    markupPercentage: 0.30,
    teams: ['Los Tigres', 'Bravos', 'Cardenales', 'Águilas', 'Leones'],
    players: [],
    payments: [], // { id, playerId, amount, currency, rateEurBs, equivalentUsd, date }
    users: [
        { username: 'admin', password: 'admin123', role: 'admin' }
    ],
    session: null, // { username, role }
    cloudConfig: {
        url: 'https://ivpwdljlczqszfhheexy.supabase.co',
        key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2cHdkbGpsY3pxc3pmaGhlZXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNDc1MjgsImV4cCI6MjA4ODgyMzUyOH0.YtOPAjOYtZ3vJ4q-N3X9UFuiEV3neqgPyuTwS2GPU-Q',
        enabled: true
    }
};

let supabaseClient = null;
let appState = { ...defaultState };

async function initSupabase() {
    if (appState.cloudConfig?.url && appState.cloudConfig?.key) {
        // Retry logic if script is still loading
        for (let i = 0; i < 5; i++) {
            if (window.supabase) break;
            await new Promise(r => setTimeout(r, 500));
        }

        try {
            if (window.supabase) {
                supabaseClient = window.supabase.createClient(appState.cloudConfig.url, appState.cloudConfig.key);
            } else {
                console.error("Supabase script not found");
                supabaseClient = null;
            }
        } catch (e) {
            console.error("Supabase init error:", e);
            supabaseClient = null;
        }
    }
}

// Utility to update visual cloud status
function setCloudStatus(status, message) {
    const led = el('cloud-led');
    const text = el('cloud-status-text');
    
    led.classList.remove('online', 'offline', 'syncing');
    
    if (status === 'syncing') {
        led.classList.add('syncing');
        text.textContent = message || 'Sincronizando...';
    } else if (status === 'online') {
        led.classList.add('online');
        text.textContent = message || 'Conectado';
    } else {
        led.classList.add('offline');
        text.textContent = message || 'Desconectado';
    }
}

// Safe Element Helper
const el = (id) => document.getElementById(id) || {
    classList: { add: () => { }, remove: () => { }, toggle: () => { }, contains: () => false },
    style: {},
    addEventListener: () => { },
    dataset: {},
    textContent: ''
};

// Initialize App
async function initApp() {
    try {
        console.log("App starting...");
        loadData();
        
        // Ensure we try to sync users BEFORE allowing login
        await initSupabase();
        if (supabaseClient) {
            setCloudStatus('syncing');
            try {
                await syncFromCloud();
                setCloudStatus('online');
            } catch (e) {
                console.warn("Initial sync failed:", e.message);
                setCloudStatus('offline', 'Error Sync Inicial');
            }
        } else {
            setCloudStatus('offline', 'Sin conexión');
        }

        // Ensure default users and correct format
        if (!appState.users || !Array.isArray(appState.users) || appState.users.length === 0) {
            appState.users = [{ username: 'admin', password: 'admin123', role: 'admin' }];
        }

        // Initial dummy data if empty
        if (appState.players.length === 0) {
            generateDummyData();
            saveData();
        }

        setupEventListeners();
        // Always require login on page load — never restore a persisted session
        delete appState.session;
        updateAuthUI();
        renderApp();
        console.log("App ready.");
    } catch (e) {
        console.error("Critical Startup Error:", e);
        setCloudStatus('offline', 'Error Crítico');
        updateAuthUI();
        renderApp();
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    el('loading-overlay').classList.toggle('hidden', !show);
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

function updateAuthUI() {
    try {
        const loginView = el('view-login');
        const appContainer = document.querySelector('.app-container') || { classList: { add: () => { }, remove: () => { } } };

        if (appState.session) {
            loginView.classList.add('hidden');
            appContainer.classList.remove('hidden');
            el('display-user-name').textContent = appState.session.username;

            const isAdmin = appState.session.role === 'admin';
            const actionIds = [
                'btn-new-payment', 'btn-update-rate', 'btn-daily-closure',
                'btn-empty-data', 'btn-reset-data', 'btn-import-csv',
                'btn-open-add-user', 'btn-add-team', 'btn-save-cloud-config'
            ];

            actionIds.forEach(id => el(id).classList.toggle('hidden', !isAdmin));

            document.querySelectorAll('#view-settings h3').forEach(h3 => {
                if (h3.textContent.includes('Gestión de Usuarios')) {
                    h3.classList.toggle('hidden', !isAdmin);
                    if (h3.nextElementSibling) h3.nextElementSibling.classList.toggle('hidden', !isAdmin);
                }
            });

            renderUsersList();
        } else {
            loginView.classList.remove('hidden');
            appContainer.classList.add('hidden');
        }
    } catch (e) {
        console.error("Error updating Auth UI:", e);
    }
}

// Data Handling
function loadData() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Deep merge cloudConfig to prevent it from being overwritten by an empty object
            const cloudConfig = { ...defaultState.cloudConfig, ...(parsed.cloudConfig || {}) };
            appState = { ...defaultState, ...parsed, cloudConfig };
            // Extra safety for users array
            if (appState.users && !Array.isArray(appState.users)) {
                appState.users = [appState.users];
            }
        }
    } catch (e) {
        console.error("Error loading local data:", e);
        appState = { ...defaultState };
    }
}

function saveData() {
    try {
        // Strip session before persisting — login must happen on every visit
        const toSave = { ...appState };
        delete toSave.session;
        localStorage.setItem(STATE_KEY, JSON.stringify(toSave));
        if (supabaseClient) saveToCloud();
    } catch (e) {
        console.error("Error saving data:", e);
    }
}

async function syncFromCloud() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('tournament_data')
            .select('payload')
            .eq('id', 'default')
            .single();

        if (data && data.payload) {
            // Never restore session from cloud
            const cloudData = { ...data.payload };
            delete cloudData.session;
            
            // Intelligent Merge: Don't let users become empty if local has them
            if (cloudData.users && Array.isArray(cloudData.users) && cloudData.users.length > 0) {
                appState.users = cloudData.users;
            } else if (cloudData.users && !Array.isArray(cloudData.users)) {
                // Fix if somehow it's an object
                appState.users = [cloudData.users];
            }
            
            // Merge other fields
            appState = { ...appState, ...cloudData, users: appState.users };
            localStorage.setItem(STATE_KEY, JSON.stringify(appState));
        } else if (error && error.code === 'PGRST116') {
            await saveToCloud();
        }
    } catch (e) {
        console.error("Cloud sync error:", e);
        throw e;
    }
}

async function saveToCloud() {
    if (!supabaseClient) return;
    try {
        setCloudStatus('syncing');
        // Strip session before uploading — never persist login state to cloud
        const cloudPayload = { ...appState };
        delete cloudPayload.session;
        
        const { error } = await supabaseClient
            .from('tournament_data')
            .upsert({ id: 'default', payload: cloudPayload });
            
        if (error) throw error;
        
        console.log("Cloud save success");
        setCloudStatus('online');
    } catch (e) {
        console.error("Cloud save error:", e);
        setCloudStatus('offline', 'Fallo al Guardar');
    }
}

function generateDummyData() {
    let playerId = 1;
    appState.players = [];
    appState.teams = ['Los Tigres', 'Bravos', 'Cardenales', 'Águilas', 'Leones'];

    appState.teams.forEach(team => {
        for (let i = 1; i <= 15; i++) {
            let name = `Jugador ${i} ${team}`;
            let dni = `V-${1000000 + playerId}`;

            if (team === 'Los Tigres' && i === 1) { name = 'Walter Pulido'; dni = '19444294'; }
            if (team === 'Bravos' && i === 1) { name = 'Lia Carofiglio'; }
            if (team === 'Cardenales' && i === 1) { name = 'Gabrielle De Laurentis'; }

            appState.players.push({ id: playerId++, name, dni, team });
        }
    });
}

// Finance
function getPlayerDebts(playerId) {
    const playerPayments = appState.payments.filter(p => p.playerId === playerId);
    const paidUsd = playerPayments.reduce((acc, p) => acc + (p.equivalentUsd || 0), 0);
    const remainingUsd = appState.baseCostUSD - paidUsd;

    if (remainingUsd <= 0.001) return { remainingUsd: 0, remainingBs: 0, paidUsd };

    const remainingEur = remainingUsd * (1 + appState.markupPercentage);
    const remainingBs = remainingEur * appState.currentRateEurBs;

    return {
        remainingUsd: parseFloat(remainingUsd.toFixed(2)),
        remainingBs: parseFloat(remainingBs.toFixed(2)),
        paidUsd: parseFloat(paidUsd.toFixed(2))
    };
}

function calcEquivalentUsd(amount, currency, rateEurBs) {
    if (currency === 'USD') return amount;
    if (currency === 'BS') {
        return (amount / rateEurBs) / (1 + appState.markupPercentage);
    }
    return 0;
}

// UI Rendering
function renderApp() {
    try {
        el('sidebar-rate').textContent = (appState.currentRateEurBs || 0).toFixed(2) + ' Bs';
        const costInput = document.getElementById('setting-base-cost');
        if (costInput) costInput.value = appState.baseCostUSD;
        const markupInput = document.getElementById('setting-markup');
        if (markupInput) markupInput.value = (appState.markupPercentage || 0) * 100;

        renderDashboard();
        renderTeams();
        populatePlayerSelect();
    } catch (e) {
        console.error("Render error:", e);
    }
}

function renderDashboard() {
    try {
        let globalCollectedUsd = 0;
        let playersFullyPaid = 0;

        appState.players.forEach(p => {
            const debt = getPlayerDebts(p.id);
            globalCollectedUsd += debt.paidUsd;
            if (debt.remainingUsd <= 0) playersFullyPaid++;
        });

        const globalPendingUsd = (appState.players.length * appState.baseCostUSD) - globalCollectedUsd;

        el('stat-collected-usd').textContent = `$${globalCollectedUsd.toFixed(2)}`;
        el('stat-pending-usd').textContent = `$${Math.max(0, globalPendingUsd).toFixed(2)}`;
        el('stat-paid-players').textContent = `${playersFullyPaid} / ${appState.players.length}`;

        const tbody = el('recent-payments-list');
        tbody.innerHTML = '';
        const recent = [...appState.payments].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

        recent.forEach(pay => {
            const player = appState.players.find(p => p.id === pay.playerId) || { name: '?', team: '-' };
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(pay.date).toLocaleDateString()}</td>
                <td><strong>${player.name}</strong></td>
                <td>${player.team}</td>
                <td><span class="badge badge-${pay.currency.toLowerCase()}">${pay.amount.toFixed(2)} ${pay.currency}</span></td>
                <td class="amount-usd">$${pay.equivalentUsd.toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Dashboard render error:", e);
    }
}

function renderTeams() {
    try {
        const container = el('teams-list');
        container.innerHTML = '';

        appState.teams.forEach(team => {
            const teamPlayers = appState.players.filter(p => p.team === team);
            const section = document.createElement('div');
            section.className = 'team-section';

            let playersHtml = '';
            teamPlayers.forEach(p => {
                const debt = getPlayerDebts(p.id);
                const isPaid = debt.remainingUsd <= 0;
                const debtHtml = isPaid ? `<span class="debt-usd debt-zero">PAGADO</span>` : `
                    <span class="debt-usd">$${debt.remainingUsd.toFixed(2)}</span>
                    <span class="debt-bs">${debt.remainingBs.toFixed(2)} Bs</span>`;

                playersHtml += `
                    <div class="player-row">
                        <div class="player-info">
                            <h4>${p.name} ${appState.session?.role === 'admin' ? `<span class="edit-icon action-edit-player" data-id="${p.id}" style="cursor:pointer; opacity:0.5;">✏️</span>` : ''}</h4>
                            <p>${p.dni || 'S/C'}</p>
                        </div>
                        <div class="player-debt">${debtHtml}</div>
                    </div>`;
            });

            section.innerHTML = `
                <div class="team-header">
                    <h3>${team} (${teamPlayers.length})</h3>
                    ${appState.session?.role === 'admin' ? `<button class="btn btn-outline btn-sm action-pay-team" data-team="${team}">Acciones</button>` : ''}
                </div>
                <div class="player-list">${playersHtml}</div>`;
            container.appendChild(section);
        });
    } catch (e) {
        console.error("Teams render error:", e);
    }
}

function populatePlayerSelect() {
    const select = el('pay-player-select');
    if (!select.innerHTML) return; // Not a real select or not in DOM
    select.innerHTML = '<option value="">-- Selecciona --</option>';
    appState.teams.forEach(team => {
        const group = document.createElement('optgroup');
        group.label = team;
        appState.players.filter(p => p.team === team).forEach(p => {
            const debt = getPlayerDebts(p.id);
            if (debt.remainingUsd > 0) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} ($${debt.remainingUsd.toFixed(2)})`;
                group.appendChild(opt);
            }
        });
        select.appendChild(group);
    });
}

function setupEventListeners() {
    const bind = (id, event, handler) => el(id).addEventListener(event, handler);

    // Nav
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            nav.classList.add('active');
            document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
            const view = el(`view-${nav.dataset.view}`);
            view.classList.remove('hidden');
            if (nav.dataset.view === 'dashboard') renderDashboard();
            if (nav.dataset.view === 'teams') renderTeams();
            if (nav.dataset.view === 'settings') {
                // Only overwrite if appState has a value, otherwise keep the HTML value
                if (appState.cloudConfig?.url) el('cloud-url').value = appState.cloudConfig.url;
                if (appState.cloudConfig?.key) el('cloud-key').value = appState.cloudConfig.key;
                el('setting-base-cost').value = appState.baseCostUSD;
                el('setting-markup').value = (appState.markupPercentage * 100).toFixed(0);
            }
            // Close sidebar on mobile after navigation
            closeMobileSidebar();
        });
    });

    // Mobile sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    bind('btn-hamburger', 'click', () => {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
    });

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }

    // Delegated 
    const tList = el('teams-list');
    tList.addEventListener('click', (e) => {
        const row = e.target.closest('.player-row');
        if (row && !e.target.classList.contains('action-edit-player') && !e.target.classList.contains('action-pay-team')) {
            const edit = row.querySelector('.action-edit-player');
            if (edit) openPlayerDetail(parseInt(edit.dataset.id));
        }
        if (e.target.classList.contains('action-edit-player')) {
            openPlayerDetail(parseInt(e.target.dataset.id));
        }
        if (e.target.classList.contains('action-pay-team')) {
            handleTeamAction(e.target.dataset.team);
        }
    });

    // Modals
    document.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden')));

    bind('btn-update-rate', 'click', () => {
        el('update-rate-input').value = appState.currentRateEurBs;
        el('modal-rate').classList.remove('hidden');
    });

    bind('btn-submit-rate', 'click', () => {
        const val = parseFloat(el('update-rate-input').value);
        if (val > 0) {
            appState.currentRateEurBs = val;
            saveData();
            renderApp();
            el('modal-rate').classList.add('hidden');
        }
    });

    bind('btn-new-payment', 'click', () => {
        el('search-player-input').value = '';
        renderSearchResults('');
        el('modal-search-player').classList.remove('hidden');
    });

    el('search-player-input').addEventListener('input', (e) => renderSearchResults(e.target.value));

    // Detail Preview
    const detAmt = el('detail-pay-amount');
    const detCur = el('detail-pay-currency');
    const detRat = el('detail-pay-rate');
    const updatePrev = () => {
        const eq = calcEquivalentUsd(parseFloat(detAmt.value) || 0, detCur.value, parseFloat(detRat.value) || appState.currentRateEurBs);
        el('detail-pay-preview-usd').textContent = `$${eq.toFixed(2)} USD`;
    };
    detAmt.addEventListener('input', updatePrev);
    detCur.addEventListener('change', () => {
        el('detail-pay-rate-group').classList.toggle('hidden', detCur.value !== 'BS');
        updatePrev();
    });
    detRat.addEventListener('input', updatePrev);

    bind('btn-submit-detail-payment', 'click', () => {
        const pId = parseInt(el('search-player-input').dataset.selectedId);
        const amt = parseFloat(detAmt.value);
        if (!pId || isNaN(amt) || amt <= 0) return alert("Datos inválidos");

        appState.payments.push({
            id: Date.now(),
            playerId: pId,
            amount: amt,
            currency: detCur.value,
            rateEurBs: detCur.value === 'BS' ? (parseFloat(detRat.value) || appState.currentRateEurBs) : null,
            equivalentUsd: calcEquivalentUsd(amt, detCur.value, parseFloat(detRat.value) || appState.currentRateEurBs),
            date: new Date().toISOString()
        });
        saveData();
        renderApp();
        openPlayerDetail(pId);
        detAmt.value = '';
    });

    bind('btn-save-detail-info', 'click', () => {
        const pId = parseInt(el('search-player-input').dataset.selectedId);
        const player = appState.players.find(p => p.id === pId);
        if (player) {
            player.name = el('detail-edit-name').value;
            player.dni = el('detail-edit-dni').value;
            player.team = el('detail-edit-team').value;
            saveData();
            renderApp();
            alert("Guardado");
        }
    });

    bind('btn-delete-player', 'click', () => {
        if (confirm("¿Eliminar jugador?")) {
            const pId = parseInt(el('search-player-input').dataset.selectedId);
            appState.players = appState.players.filter(p => p.id !== pId);
            appState.payments = appState.payments.filter(p => p.playerId !== pId);
            saveData();
            renderApp();
            el('modal-player-detail').classList.add('hidden');
        }
    });

    bind('btn-save-settings', 'click', () => {
        appState.baseCostUSD = parseFloat(el('setting-base-cost').value);
        appState.markupPercentage = parseFloat(el('setting-markup').value) / 100;
        saveData();
        renderApp();
    });

    bind('btn-save-cloud-config', 'click', async () => {
        try {
            const url = el('cloud-url').value;
            const key = el('cloud-key').value;
            if (!url || !key) return alert("Por favor ingresa la URL y la Key");
            
            appState.cloudConfig = { url, key, enabled: true };
            saveData();
            showLoading(true);
            await initSupabase();
            if (!supabaseClient) throw new Error("No se pudo conectar a Supabase");
            
            await syncFromCloud();
            showLoading(false);
            renderApp();
            alert("✅ Sincronización exitosa");
        } catch (e) {
            console.error("Manual sync error:", e);
            showLoading(false);
            setCloudStatus('offline', 'Error Manual');
            alert("❌ Error: " + (e.message || "No se pudo conectar"));
        }
    });

    bind('btn-do-login', 'click', handleLogin);
    el('login-password').addEventListener('keypress', (e) => e.key === 'Enter' && handleLogin());
    bind('btn-logout', 'click', () => { if (confirm("¿Salir?")) { appState.session = null; saveData(); location.reload(); } });

    bind('btn-open-add-user', 'click', () => el('modal-add-user').classList.remove('hidden'));
    bind('btn-submit-add-user', 'click', () => {
        const u = el('new-user-username').value;
        const p = el('new-user-password').value;
        const r = el('new-user-role').value;
        if (u && p) {
            appState.users.push({ username: u, password: p, role: r });
            saveData();
            renderUsersList();
            el('modal-add-user').classList.add('hidden');
        }
    });
}

function handleLogin() {
    const u = el('login-username').value;
    const p = el('login-password').value;
    const user = appState.users.find(x => x.username === u && x.password === p);
    if (user) {
        appState.session = { username: user.username, role: user.role };
        saveData();
        updateAuthUI();
        renderApp();
    } else {
        el('login-error').classList.remove('hidden');
    }
}

function renderUsersList() {
    const list = el('users-list');
    list.innerHTML = '';
    appState.users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${u.username}</td><td>${u.role}</td><td style="text-align:right">
            <button class="btn btn-sm btn-outline" onclick="changePass('${u.username}')">Clave</button>
            ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.username}')">X</button>` : ''}
        </td>`;
        list.appendChild(tr);
    });
}

window.changePass = (u) => {
    el('change-pass-username-display').textContent = u;
    el('modal-change-password').classList.remove('hidden');
};
window.deleteUser = (u) => {
    if (confirm("¿Eliminar?")) {
        appState.users = appState.users.filter(x => x.username !== u);
        saveData();
        renderUsersList();
    }
};

function openPlayerDetail(pId) {
    const p = appState.players.find(x => x.id === pId);
    if (!p) return;
    el('search-player-input').dataset.selectedId = pId;
    el('detail-title').textContent = p.name;
    el('detail-edit-name').value = p.name;
    el('detail-edit-dni').value = p.dni || '';

    const teamSel = el('detail-edit-team');
    teamSel.innerHTML = '';
    appState.teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t; if (t === p.team) opt.selected = true;
        teamSel.appendChild(opt);
    });

    const d = getPlayerDebts(pId);
    el('detail-debt-usd').textContent = `$${d.remainingUsd.toFixed(2)}`;
    el('detail-debt-bs').textContent = `${d.remainingBs.toFixed(2)} Bs`;

    const hist = el('detail-payments-list');
    hist.innerHTML = '';
    appState.payments.filter(x => x.playerId === pId).forEach(pay => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${new Date(pay.date).toLocaleDateString()}</td><td>${pay.amount} ${pay.currency}</td><td>$${pay.equivalentUsd.toFixed(2)}</td><td></td>`;
        hist.appendChild(tr);
    });
    el('modal-player-detail').classList.remove('hidden');
    el('modal-search-player').classList.add('hidden');
}

function renderSearchResults(q) {
    const list = el('search-results-list');
    list.innerHTML = '';
    if (!q || q.length < 2) return;
    appState.players.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.dni?.includes(q)).slice(0, 10).forEach(p => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.style.padding = '10px';
        div.style.borderBottom = '1px solid #333';
        div.style.cursor = 'pointer';
        div.innerHTML = `<strong>${p.name}</strong> - ${p.team}`;
        div.onclick = () => openPlayerDetail(p.id);
        list.appendChild(div);
    });
}

function handleTeamAction(team) {
    const action = prompt("1. Pagar todo\n2. Renombrar\nAcción:");
    if (action === '1') {
        appState.players.filter(p => p.team === team).forEach(p => {
            const d = getPlayerDebts(p.id);
            if (d.remainingUsd > 0) {
                appState.payments.push({
                    id: Date.now() + Math.random(),
                    playerId: p.id, amount: d.remainingUsd, currency: 'USD',
                    equivalentUsd: d.remainingUsd, date: new Date().toISOString()
                });
            }
        });
        saveData(); renderApp();
    }
}

// Global Start
document.addEventListener('DOMContentLoaded', initApp);
