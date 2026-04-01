// State Management
const STATE_KEY = 'softball_tournament_data';

async function hashPassword(plain) {
    // crypto.subtle solo funciona en HTTPS/localhost, no en file://
    if (!crypto?.subtle) return null;
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        return null;
    }
}

const defaultState = {
    baseCostUSD: 70, // Meta total en valor nominal (precio BS)
    baseCostCashUSD: 55, // Precio real si se paga en divisas
    currentRateEurBs: 45.0,
    rateLastUpdated: new Date().toISOString(),
    markupPercentage: 0.00,
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
    },
    deletedPayments: []
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

// Utility to update login screen sync status
function setLoginSyncStatus(status, message) {
    const led = document.getElementById('login-sync-led');
    const text = document.getElementById('login-sync-text');
    const btn = document.getElementById('btn-login-sync');
    if (!led || !text) return;
    led.classList.remove('online', 'offline', 'syncing');
    if (status === 'syncing') {
        led.classList.add('syncing');
        text.textContent = message || 'Sincronizando con la nube...';
        if (btn) btn.classList.add('hidden');
    } else if (status === 'online') {
        led.classList.add('online');
        text.textContent = message || 'Datos actualizados ✓';
        if (btn) btn.classList.add('hidden');
    } else {
        led.classList.add('offline');
        text.textContent = message || 'Sin conexión — datos locales';
        if (btn) btn.classList.remove('hidden');
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
            setLoginSyncStatus('syncing');
            try {
                await syncFromCloud();
                setCloudStatus('online');
                setLoginSyncStatus('online');
            } catch (e) {
                console.warn("Initial sync failed:", e.message);
                setCloudStatus('offline', 'Error Sync Inicial');
                setLoginSyncStatus('offline', 'Fallo al sincronizar — reintenta');
            }
        } else {
            setCloudStatus('offline', 'Sin conexión');
            setLoginSyncStatus('offline', 'Sin conexión a la nube');
        }

        // Ensure default users and correct format
        if (!appState.users || !Array.isArray(appState.users) || appState.users.length === 0) {
            appState.users = [{ username: 'admin', password: 'admin123', role: 'admin' }];
        }

        // Ya no generamos datos falsos automáticamente para permitir bases de datos vacías en producción.

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
    
    let totalCredit = 0; // Crédito acumulado hacia la meta de $70

    playerPayments.forEach(p => {
        if (p.currency === 'USD') {
            // Cada $1 en divisas vale más (70/55) para llegar a la meta de $70
            const multiplier = appState.baseCostUSD / appState.baseCostCashUSD;
            totalCredit += (p.amount * multiplier);
        } else if (p.currency === 'BS') {
            // Los bolívares cuentan por su valor nominal (Monto / Tasa)
            const nominalUsd = p.amount / (p.rateEurBs || appState.currentRateEurBs);
            totalCredit += nominalUsd;
        }
    });

    const remainingValue = Math.max(0, appState.baseCostUSD - totalCredit);
    
    // Deuda en BS: Basada en la meta de $70
    const remainingBs = remainingValue * appState.currentRateEurBs;
    
    // Deuda en Divisas: Basada en la proporción del precio de $55
    const remainingUsd = (remainingValue / appState.baseCostUSD) * appState.baseCostCashUSD;

    return {
        remainingUsd: parseFloat(remainingUsd.toFixed(2)),
        remainingBs: parseFloat(remainingBs.toFixed(2)),
        paidUsd: parseFloat(totalCredit.toFixed(2)) // Mostramos crédito acumulado nominal
    };
}

function calcEquivalentUsd(amount, currency, rateEurBs) {
    if (currency === 'USD') {
        const multiplier = appState.baseCostUSD / appState.baseCostCashUSD;
        return amount * multiplier;
    }
    if (currency === 'BS') {
        return amount / rateEurBs;
    }
    return 0;
}

// UI Rendering
function renderApp() {
    try {
        el('sidebar-rate').textContent = (appState.currentRateEurBs || 0).toFixed(2) + ' Bs';
        const costInput = document.getElementById('setting-base-cost');
        if (costInput) costInput.value = appState.baseCostCashUSD;
        const costBSInput = document.getElementById('setting-base-cost-bs');
        if (costBSInput) costBSInput.value = appState.baseCostUSD;
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
        const allActivities = [...appState.payments];
        if (appState.deletedPayments) {
            allActivities.push(...appState.deletedPayments.map(dp => ({ ...dp, isDeleted: true })));
        }

        const recent = allActivities.sort((a, b) => new Date(b.deletedAt || b.date) - new Date(a.deletedAt || a.date)).slice(0, 15);

        recent.forEach(pay => {
            const player = appState.players.find(p => p.id === pay.playerId) || { name: '?', team: '-' };
            const tr = document.createElement('tr');
            if (pay.isDeleted) {
                tr.innerHTML = `
                    <td><s style="color:var(--danger)">${new Date(pay.deletedAt).toLocaleDateString()}</s></td>
                    <td><s style="color:var(--danger)">${player.name}</s><br><small style="color:var(--danger)">Eliminado por: ${pay.deletedBy} (${pay.deleteReason})</small></td>
                    <td><s style="color:var(--danger)">${player.team}</s></td>
                    <td><span class="badge" style="background:var(--danger)">Anulado</span></td>
                    <td class="amount-usd"><s style="color:var(--danger)">$${pay.equivalentUsd.toFixed(2)}</s></td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${new Date(pay.date).toLocaleDateString()}</td>
                    <td><strong>${player.name}</strong></td>
                    <td>${player.team}</td>
                    <td><span class="badge badge-${pay.currency.toLowerCase()}">${pay.amount.toFixed(2)} ${pay.currency}</span></td>
                    <td class="amount-usd">$${pay.equivalentUsd.toFixed(2)}</td>
                `;
            }
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
                el('setting-base-cost').value = appState.baseCostCashUSD;
                el('setting-base-cost-bs').value = appState.baseCostUSD;
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

    bind('btn-daily-closure', 'click', () => {
        const today = new Date().toISOString().split('T')[0];
        el('closure-date-input').value = today;
        renderDailyClosure();
        el('modal-daily-closure').classList.remove('hidden');
    });

    el('closure-date-input').addEventListener('change', renderDailyClosure);

    bind('btn-export-excel', 'click', () => exportClosure('xlsx'));
    bind('btn-export-csv', 'click', () => exportClosure('csv'));
    bind('btn-export-pdf', 'click', () => exportClosure('pdf'));

    bind('btn-submit-rate', 'click', () => {
        const val = parseFloat(el('update-rate-input').value);
        if (val > 0) {
            appState.currentRateEurBs = val;
            appState.rateLastUpdated = new Date().toISOString();
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

    el('search-player-input').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
        renderSearchResults(e.target.value);
    });  // Detail Preview
    const detAmt = el('detail-pay-amount');
    const detCur = el('detail-pay-currency');
    const detRat = el('detail-pay-rate');
    const updatePrev = () => {
        const eq = calcEquivalentUsd(parseFloat(detAmt.value) || 0, detCur.value, parseFloat(detRat.value) || appState.currentRateEurBs);
        const markupText = appState.markupPercentage > 0 ? ` <small style="font-weight:400; font-size:0.8rem; opacity:0.7;">(con recargo del ${(appState.markupPercentage * 100).toFixed(0)}%)</small>` : '';
        el('detail-pay-preview-usd').innerHTML = `$${eq.toFixed(2)} USD ${markupText}`;
    };
    detAmt.addEventListener('input', updatePrev);
    detCur.addEventListener('change', () => {
        const isBS = detCur.value === 'BS';
        el('detail-pay-rate-group').classList.toggle('hidden', !isBS);
        el('detail-pay-calc-group').classList.toggle('hidden', !isBS);
        updatePrev();
    });
    
    // Nueva lógica de calculadora interactiva
    el('detail-pay-usd-helper').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        const rate = parseFloat(el('detail-pay-rate').value) || 0;
        if (val > 0 && rate > 0) {
            el('detail-pay-amount').value = (val * rate).toFixed(2);
            updatePrev();
        }
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
            player.name = el('detail-edit-name').value.toUpperCase();
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
        appState.baseCostCashUSD = parseFloat(el('setting-base-cost').value);
        appState.baseCostUSD = parseFloat(el('setting-base-cost-bs').value);
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

    bind('btn-login-sync', 'click', async () => {
        setLoginSyncStatus('syncing');
        el('login-error').classList.add('hidden');
        try {
            if (!supabaseClient) await initSupabase();
            if (!supabaseClient) throw new Error('No se pudo conectar');
            await syncFromCloud();
            setLoginSyncStatus('online');
            setCloudStatus('online');
        } catch (e) {
            console.warn("Manual login sync failed:", e.message);
            setLoginSyncStatus('offline', 'Error al sincronizar — verifica tu red');
            setCloudStatus('offline', 'Error Sync');
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

    let pendingDeletePaymentId = null;
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('action-delete-payment')) {
            pendingDeletePaymentId = parseFloat(e.target.dataset.id);
            el('confirm-auth-password').value = '';
            el('confirm-auth-error').classList.add('hidden');
            el('modal-confirm-auth').classList.remove('hidden');
        }
    });

    bind('btn-submit-confirm-auth', 'click', async () => {
        if (!pendingDeletePaymentId) return;
        const p = el('confirm-auth-password').value;
        const hash = await hashPassword(p);
        const user = appState.users.find(x => x.username === appState.session?.username);
        
        if (!user) {
            alert("Error: Sesión no válida.");
            return;
        }

        const isCorrect = (user.passwordHash && hash === user.passwordHash) || (!user.passwordHash && user.password === p);
        
        if (isCorrect) {
            el('modal-confirm-auth').classList.add('hidden');
            const reason = prompt("Describe el motivo por el cual estás eliminando/anulando este pago:");
            if (reason && reason.trim()) {
                const paymentIndex = appState.payments.findIndex(pay => pay.id === pendingDeletePaymentId);
                if (paymentIndex !== -1) {
                    const removed = appState.payments.splice(paymentIndex, 1)[0];
                    if (!appState.deletedPayments) appState.deletedPayments = [];
                    appState.deletedPayments.push({
                        ...removed,
                        deletedBy: appState.session.username,
                        deletedAt: new Date().toISOString(),
                        deleteReason: reason.trim()
                    });
                    saveData();
                    renderApp();
                    openPlayerDetail(removed.playerId);
                    alert("Pago anulado exitosamente.");
                }
            } else {
                alert("Operación cancelada. El motivo es obligatorio para el historial.");
            }
            pendingDeletePaymentId = null;
        } else {
            el('confirm-auth-error').classList.remove('hidden');
        }
    });

    bind('btn-reset-data', 'click', () => {
        if (confirm("⚠️ ¿Estás completamente seguro de que quieres restaurar los datos de fábrica? Esto borrará todos los pagos, jugadores, y equipos. ¡Esta acción no se puede deshacer!")) {
            const preservedCloud = { ...appState.cloudConfig };
            appState = { ...JSON.parse(JSON.stringify(defaultState)), cloudConfig: preservedCloud };
            saveData();
            location.reload();
        }
    });

    bind('btn-empty-data', 'click', () => {
        if (confirm("⚠️ ¿Vaciar la base de datos? Esto eliminará a TODOS los jugadores y TODOS los pagos registrados. Mantendrá tus configuraciones y usuarios. ¡No se puede deshacer!")) {
            appState.players = [];
            appState.payments = [];
            saveData();
            renderApp();
            alert("Base de datos vaciada.");
        }
    });

bind('btn-add-team', 'click', () => {
        el('add-team-input').value = '';
        el('modal-add-team').classList.remove('hidden');
    });

    bind('btn-submit-add-team', 'click', () => {
        const teamName = el('add-team-input').value.trim().toUpperCase();
        if (teamName && !appState.teams.includes(teamName)) {
            appState.teams.push(teamName);
            saveData();
            renderApp();
            el('modal-add-team').classList.remove('hidden');
        } else if (appState.teams.includes(teamName)) {
            alert("Ese equipo ya existe.");
        }
    });

    el('add-team-input').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

    bind('btn-submit-edit-team', 'click', () => {
        const oldName = el('edit-team-old-name').value;
        const newName = el('edit-team-input').value.trim();
        if (newName && newName !== oldName && !appState.teams.includes(newName)) {
            window.renameTeam(oldName, newName);
            el('modal-edit-team').classList.add('hidden');
        } else if (appState.teams.includes(newName) && newName !== oldName) {
            alert("Ya existe un equipo con ese nombre.");
        } else {
            el('modal-edit-team').classList.add('hidden');
        }
    });
}

async function handleLogin() {
    const rawU = el('login-username').value;
    const u = rawU.trim().toLowerCase();
    const p = el('login-password').value;
    const hash = await hashPassword(p);
    // Soporta: hash SHA-256 (HTTPS), texto plano legacy, y fallback cuando crypto no está disponible (file://)
    const user = appState.users.find(x => {
        if (x.username.toLowerCase() !== u) return false;
        if (x.passwordHash && hash) return x.passwordHash === hash; // usuario con hash
        return x.password === p; // usuario legacy con texto plano
    });
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

    el('detail-pay-amount').value = '';
    el('detail-pay-usd-helper').value = '';
    el('detail-pay-currency').value = 'USD';
    el('detail-pay-rate-group').classList.add('hidden');
    el('detail-pay-calc-group').classList.add('hidden');

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
        tr.innerHTML = `<td>${new Date(pay.date).toLocaleDateString()}</td><td>${pay.amount} ${pay.currency}</td><td>$${pay.equivalentUsd.toFixed(2)}</td>
        <td><button class="btn btn-sm btn-danger action-delete-payment" data-id="${pay.id}" style="padding: 2px 8px; font-size:12px;">X</button></td>`;
        hist.appendChild(tr);
    });

    // Actualizar info de la tasa fija en el modal
    el('detail-pay-rate').value = appState.currentRateEurBs;
    el('detail-pay-rate').readOnly = true;
    
    if (appState.rateLastUpdated) {
        const date = new Date(appState.rateLastUpdated);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        el('detail-rate-info').textContent = `Tasa fijada el: ${date.toLocaleDateString('es-ES', options)}`;
    }

    el('modal-player-detail').classList.remove('hidden');
    el('modal-search-player').classList.add('hidden');
}

function renderDailyClosure() {
    const selDate = el('closure-date-input').value;
    if (!selDate) return;

    const dailyPayments = appState.payments.filter(p => {
        const pDate = new Date(p.date).toISOString().split('T')[0];
        return pDate === selDate;
    });

    let totalUsd = 0;
    let totalBs = 0;
    let totalEquivalent = 0;

    const list = el('closure-payments-list');
    list.innerHTML = '';

    dailyPayments.forEach(p => {
        if (p.currency === 'USD') {
            totalUsd += p.amount;
        } else if (p.currency === 'BS') {
            totalBs += p.amount;
        }
        totalEquivalent += (p.equivalentUsd || 0);

        const player = appState.players.find(x => x.id === p.playerId);
        const name = player ? player.name : 'Desconocido';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td><td>${p.amount} ${p.currency}</td><td>$${p.equivalentUsd.toFixed(2)}</td>`;
        list.appendChild(tr);
    });

    el('closure-total-usd').textContent = `$${totalUsd.toFixed(2)}`;
    el('closure-total-bs').textContent = `${totalBs.toFixed(2)} Bs`;
    el('closure-total-equivalent').textContent = `$${totalEquivalent.toFixed(2)}`;
}

function exportClosure(format) {
    const selDate = el('closure-date-input').value;
    const dailyPayments = appState.payments.filter(p => {
        const pDate = new Date(p.date).toISOString().split('T')[0];
        return pDate === selDate;
    });

    if (dailyPayments.length === 0) {
        alert("No hay pagos registrados en esta fecha para exportar.");
        return;
    }

    const data = dailyPayments.map(p => {
        const player = appState.players.find(x => x.id === p.playerId);
        return {
            "FECHA": new Date(p.date).toLocaleDateString(),
            "JUGADOR": player ? player.name : 'N/A',
            "MONTO": p.amount,
            "MONEDA": p.currency,
            "TASA": p.currency === 'BS' ? p.rateEurBs : '-',
            "EQUIV_USD": p.equivalentUsd.toFixed(2)
        };
    });

    const fileName = `cierre_${selDate}`;

    if (format === 'csv' || format === 'xlsx') {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Cierre");
        if (format === 'xlsx') {
            XLSX.writeFile(wb, `${fileName}.xlsx`);
        } else {
            XLSX.writeFile(wb, `${fileName}.csv`, { bookType: 'csv' });
        }
    } else if (format === 'pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(`Cierre Diario: ${selDate}`, 14, 20);
        
        doc.setFontSize(10);
        const totals = [
            [`Efectivo USD: $${el('closure-total-usd').textContent.replace('$', '')}`],
            [`Bolívares: ${el('closure-total-bs').textContent}`],
            [`Total Equivalente: ${el('closure-total-equivalent').textContent}`]
        ];
        
        doc.text("Resumen de Caja:", 14, 30);
        let y = 35;
        totals.forEach((t, i) => {
            doc.text(t[0], 14, y + (i * 5));
        });

        const tableBody = data.map(d => [d.JUGADOR, `${d.MONTO} ${d.MONEDA}`, `$${d.EQUIV_USD}`]);
        
        doc.autoTable({
            startY: 55,
            head: [['Jugador', 'Monto Original', 'Crédito USD']],
            body: tableBody,
            theme: 'grid'
        });
        
        doc.save(`${fileName}.pdf`);
    }
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

    const addBtn = document.createElement('div');
    addBtn.className = 'btn btn-primary btn-sm mt-4';
    addBtn.style.display = 'block';
    addBtn.style.textAlign = 'center';
    addBtn.innerHTML = `+ Registrar nuevo: "<strong>${q}</strong>" (Agente Libre / Sin Equipo)`;
    addBtn.onclick = () => {
        const pId = Date.now();
        // Si "Sin Equipo" no existe en los equipos, el jugador igual puede tenerlo
        if (!appState.teams.includes('Sin Equipo')) appState.teams.push('Sin Equipo');
        
        appState.players.push({
            id: pId,
            name: q.toUpperCase(),
            dni: '',
            team: 'Sin Equipo'
        });
        saveData();
        renderApp();
        openPlayerDetail(pId);
    };
    list.appendChild(addBtn);
}

function handleTeamAction(team) {
    const action = prompt("1. Pagar todo\n2. Renombrar\n3. Eliminar equipo\nAcción (ingrese 1, 2 o 3):");
    if (action === '1') {
        if (!confirm(`¿Seguro que quieres registrar pagos para saldar la deuda de TODOS los jugadores de ${team}?`)) return;
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
        saveData(); 
        renderApp();
        alert("✔️ Se han registrado los pagos correspondientes a este equipo.");
    } else if (action === '2') {
        const modal = document.getElementById('modal-edit-team');
        if (modal) {
            document.getElementById('edit-team-old-name').value = team;
            document.getElementById('edit-team-input').value = team;
            modal.classList.remove('hidden');
        } else {
            // Fallback si no hay modal
            const newName = prompt(`Nuevo nombre para ${team}:`, team);
            if (newName && newName.trim() !== '') renameTeam(team, newName.trim());
        }
    } else if (action === '3') {
        if (confirm(`⚠️ ¿Estás completamente seguro de que quieres eliminar el equipo "${team}"? (Los jugadores no se borrarán, solo quedarán sin equipo asignado).`)) {
            appState.teams = appState.teams.filter(t => t !== team);
            appState.players.forEach(p => { if (p.team === team) p.team = "Sin Equipo"; });
            saveData();
            renderApp();
            alert("Equipo eliminado.");
        }
    }
}

// Función auxiliar
window.renameTeam = function(oldName, newName) {
    if (oldName === newName) return;
    const index = appState.teams.indexOf(oldName);
    if (index !== -1) appState.teams[index] = newName;
    appState.players.forEach(p => { if (p.team === oldName) p.team = newName; });
    saveData();
    renderApp();
};

// Global Start
document.addEventListener('DOMContentLoaded', initApp);
