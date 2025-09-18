// public/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    const sidebarBtn = document.querySelector('.sidebarBtn');
    const navLinks = document.querySelectorAll('.nav-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const dashboardTitle = document.querySelector('.dashboard-title');
    const overlay = document.querySelector('.overlay');

    sidebarBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        } else {
            sidebar.classList.toggle('close');
        }
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = link.dataset.tab;

            navLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(t => t.classList.remove('active'));

            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            dashboardTitle.textContent = link.querySelector('.link_name').textContent;

            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            }
        });
    });

    async function api(path, opts = {}) {
        const response = await fetch('/admin/api' + path, opts);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || error.error || 'API request failed');
        }
        return response.status === 204 ? null : response.json();
    }

    function showAlert(message, isError = false) {
        alert(message);
        if (isError) console.error(message);
    }

    window.copyToClipboard = (text, button) => {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert('Could not copy text.');
        });
    }

    // --- Dashboard Stats ---
    async function fetchStats() {
        try {
            const stats = await api('/stats');
            document.getElementById('stat-prompts').textContent = stats.promptCount.toLocaleString();
            document.getElementById('stat-input-tokens').textContent = stats.totalInputTokens.toLocaleString();
            document.getElementById('stat-output-tokens').textContent = stats.totalOutputTokens.toLocaleString();
        } catch (error) { console.error('Failed to fetch stats:', error); }
    }
    
    // --- Server Clock ---
    let serverClockInterval;
    async function startServerClock() {
        try {
            const data = await api('/server-time');
            let serverNow = new Date(data.serverTime);
            
            const timeElement = document.getElementById('stat-server-time');

            if (serverClockInterval) clearInterval(serverClockInterval);

            serverClockInterval = setInterval(() => {
                serverNow.setSeconds(serverNow.getSeconds() + 1);
                
                const datePart = serverNow.toLocaleDateString('en-CA', { timeZone: 'UTC' });
                const timePart = serverNow.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false });

                timeElement.innerHTML = `${datePart}<br>${timePart}`;
            }, 1000);

        } catch (error) {
            console.error('Failed to start server clock:', error);
            document.getElementById('stat-server-time').textContent = 'Error';
        }
    }
    
    fetchStats();
    startServerClock();
    setInterval(fetchStats, 5000);

    // --- Structure Editor ---
    const providerSelector = document.getElementById('providerSelector');
    const blocksList = document.getElementById('blocksList');
    let currentBlocks = [];
    let pristineBlocks = '[]';
    let currentlyEditingIndex = -1;

    blocksList.addEventListener('change', (event) => {
        if (event.target.classList.contains('edit-block-type')) {
            const blockItem = event.target.closest('.block-item');
            const replacementIdWrapper = blockItem.querySelector('.edit-replacement-id-wrapper');
            if (event.target.value === 'Prompting Fallback') {
                replacementIdWrapper.style.display = 'block';
            } else {
                replacementIdWrapper.style.display = 'none';
            }
        }
    });

    function updateSaveButtonState() {
        const saveBtn = document.getElementById('saveStructureBtn');
        const hasChanges = JSON.stringify(currentBlocks) !== pristineBlocks;
        saveBtn.disabled = !hasChanges;
    }

    async function fetchStructure(provider) {
        try {
            currentlyEditingIndex = -1;
            const data = await api(`/structure?provider=${provider}`);
            currentBlocks = data.blocks || [];
            pristineBlocks = JSON.stringify(currentBlocks);
            renderBlocks();
            updateSaveButtonState();
        } catch (error) {
            alert('Error fetching structure: ' + error.message);
        }
    }

    function renderBlocks() {
        blocksList.innerHTML = '';
        currentBlocks.forEach((block, index) => {
            const isEditing = index === currentlyEditingIndex;
            const isInjection = ['Jailbreak', 'Additional Commands', 'Prefill', 'Unparsed Text Injection'].includes(block.block_type);
            const isFallback = block.block_type === 'Prompting Fallback';
            
            const el = document.createElement('div');
            el.className = `block-item ${isEditing ? 'is-editing' : ''} ${isInjection ? 'is-injection-point' : ''}`;
            el.innerHTML = `
                <div class="block-header">
                    <div class="block-info">
                        <span class="block-name">${block.name || 'Unnamed Block'}</span>
                        <span class="block-role">(${block.role}) ${isInjection ? '[Injection Point]' : ''} ${isFallback ? '[Fallback]' : ''}</span>
                    </div>
                    <div class="block-actions">
                        <div class="move-controls">
                            <button class="btn-secondary btn-move" onclick="moveBlock(${index}, -1)" ${index === 0 ? 'disabled' : ''}>
                                <i class='bx bx-up-arrow-alt'></i>
                            </button>
                            <button class="btn-secondary btn-move" onclick="moveBlock(${index}, 1)" ${index === currentBlocks.length - 1 ? 'disabled' : ''}>
                                <i class='bx bx-down-arrow-alt'></i>
                            </button>
                        </div>
                        <div class="edit-controls">
                            <button class="btn-secondary" onclick="toggleEdit(${index})">${isEditing ? 'Cancel' : 'Edit'}</button>
                            <button class="btn-secondary" style="background-color: var(--red);" onclick="deleteBlock(${index})">Delete</button>
                        </div>
                    </div>
                </div>
                <div class="block-editor">
                    <div class="block-editor-grid">
                        <input class="edit-name" value="${block.name || ''}" placeholder="Block Name">
                        <select class="edit-role">
                            <option value="system" ${block.role === 'system' ? 'selected' : ''}>system</option>
                            <option value="user" ${block.role === 'user' ? 'selected' : ''}>user</option>
                            <option value="assistant" ${block.role === 'assistant' ? 'selected' : ''}>assistant</option>
                        </select>
                    </div>
                    <select class="edit-block-type">
                        <option value="Standard" ${block.block_type === 'Standard' ? 'selected' : ''}>Standard</option>
                        <option value="Jailbreak" ${block.block_type === 'Jailbreak' ? 'selected' : ''}>Jailbreak Injection</option>
                        <option value="Additional Commands" ${block.block_type === 'Additional Commands' ? 'selected' : ''}>Commands Injection</option>
                        <option value="Prefill" ${block.block_type === 'Prefill' ? 'selected' : ''}>Prefill Injection</option>
                        <option value="Conditional Prefill" ${block.block_type === 'Conditional Prefill' ? 'selected' : ''}>Conditional Prefill</option>
                        <option value="Prompting Fallback" ${isFallback ? 'selected' : ''}>Prompting Fallback</option>
                        <option value="Unparsed Text Injection" ${block.block_type === 'Unparsed Text Injection' ? 'selected' : ''}>Unparsed Text Injection</option>
                    </select>

                    <div class="edit-replacement-id-wrapper" style="display: ${isFallback ? 'block' : 'none'}; margin-top: 15px;">
                        <label>Replacement Command ID</label>
                        <input class="edit-replacement-id" value="${block.replacement_command_id || ''}" placeholder="e.g., writing_style_gemini">
                        <p class="muted" style="margin-top: -10px; font-size: 0.8em;">If a user triggers a command with this ID, it will replace this block's content.</p>
                    </div>

                    <textarea class="edit-content" placeholder="Block content..." ${isInjection ? 'disabled' : ''}>${block.content || ''}</textarea>
                    <div class="action-buttons">
                        <button class="btn-primary" onclick="saveBlockEdit(${index})">Save Changes</button>
                    </div>
                </div>
            `;
            blocksList.appendChild(el);
        });
    }
    
    window.moveBlock = (index, direction) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= currentBlocks.length) return;
        [currentBlocks[index], currentBlocks[newIndex]] = [currentBlocks[newIndex], currentBlocks[index]];
        if(currentlyEditingIndex === index) currentlyEditingIndex = newIndex;
        else if (currentlyEditingIndex === newIndex) currentlyEditingIndex = index;
        renderBlocks();
        updateSaveButtonState();
    };

    window.toggleEdit = (index) => {
        currentlyEditingIndex = (currentlyEditingIndex === index) ? -1 : index;
        renderBlocks();
    };

    window.deleteBlock = (index) => {
        if (!confirm('Are you sure you want to delete this block?')) return;
        currentBlocks.splice(index, 1);
        currentlyEditingIndex = -1;
        renderBlocks();
        updateSaveButtonState();
    };

    window.saveBlockEdit = (index) => {
        const blockItem = blocksList.children[index];
        currentBlocks[index].name = blockItem.querySelector('.edit-name').value;
        currentBlocks[index].role = blockItem.querySelector('.edit-role').value;
        currentBlocks[index].block_type = blockItem.querySelector('.edit-block-type').value;
        currentBlocks[index].content = blockItem.querySelector('.edit-content').value;
        
        if (currentBlocks[index].block_type === 'Prompting Fallback') {
            currentBlocks[index].replacement_command_id = blockItem.querySelector('.edit-replacement-id').value.trim();
        } else {
            currentBlocks[index].replacement_command_id = null;
        }

        currentlyEditingIndex = -1;
        renderBlocks();
        updateSaveButtonState();
    };

    document.getElementById('addBlockBtn').onclick = () => {
        currentBlocks.push({ 
            name: 'New Block', 
            role: 'system', 
            content: '', 
            is_enabled: true, 
            block_type: 'Standard',
            replacement_command_id: null
        });
        currentlyEditingIndex = currentBlocks.length - 1;
        renderBlocks();
        updateSaveButtonState();
    };

    document.getElementById('saveStructureBtn').onclick = async () => {
        try {
            await api(`/structure?provider=${providerSelector.value}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocks: currentBlocks })
            });
            pristineBlocks = JSON.stringify(currentBlocks);
            updateSaveButtonState();
            alert('Structure saved successfully!');
        } catch (error) {
            alert('Error saving structure: ' + error.message);
        }
    };

    providerSelector.onchange = () => fetchStructure(providerSelector.value);
    fetchStructure(providerSelector.value);

    // --- Command Editor ---
    const commandsList = document.getElementById('commandsList');
    const commandForm = document.getElementById('command-form');
    const commandFormTitle = document.getElementById('command-form-title');
    let allCommands = [];

    async function fetchCommands() {
        try {
            const data = await api('/commands');
            allCommands = data.commands || [];
            renderCommands();
        } catch (error) {
            alert('Error fetching commands: ' + error.message);
        }
    }

    function renderCommands() {
        commandsList.innerHTML = allCommands.map(cmd => `
            <div class="command-item">
                <div class="cmd-info">
                    <strong><code>&lt;${cmd.command_tag}&gt;</code></strong> - ${cmd.block_name} (${cmd.command_type})
                    ${cmd.command_id ? `<br><span style="font-size: 0.8em; color: var(--text-muted);">ID: ${cmd.command_id}</span>` : ''}
                </div>
                <div class="cmd-actions">
                    <button class="btn-secondary" onclick="editCommand(${cmd.id})">Edit</button>
                    <button class="btn-secondary" onclick="deleteCommand(${cmd.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    window.editCommand = (id) => {
        const cmd = allCommands.find(c => c.id == id);
        if (!cmd) return;
        commandFormTitle.textContent = 'Edit Command';
        document.getElementById('cmd_id').value = cmd.id;
        document.getElementById('cmd_tag').value = cmd.command_tag;
        document.getElementById('cmd_id_internal').value = cmd.command_id || '';
        document.getElementById('cmd_name').value = cmd.block_name;
        document.getElementById('cmd_role').value = cmd.block_role;
        document.getElementById('cmd_type').value = cmd.command_type;
        document.getElementById('cmd_content').value = cmd.block_content;
    };

    window.deleteCommand = async (id) => {
        if (!confirm('Are you sure you want to delete this command?')) return;
        try {
            await api(`/commands/${id}`, { method: 'DELETE' });
            fetchCommands();
        } catch (error) {
            alert('Error deleting command: ' + error.message);
        }
    };

    document.getElementById('cmd_clear_btn').onclick = () => {
        commandFormTitle.textContent = 'Add New Command';
        commandForm.reset();
        document.getElementById('cmd_id').value = '';
    };

    commandForm.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
            id: document.getElementById('cmd_id').value || null,
            command_tag: document.getElementById('cmd_tag').value,
            command_id: document.getElementById('cmd_id_internal').value.trim() || null,
            block_name: document.getElementById('cmd_name').value,
            block_role: document.getElementById('cmd_role').value,
            command_type: document.getElementById('cmd_type').value,
            block_content: document.getElementById('cmd_content').value,
        };
        try {
            await api('/commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            document.getElementById('cmd_clear_btn').click();
            fetchCommands();
        } catch (error) {
            alert('Error saving command: ' + error.message);
        }
    };
    fetchCommands();

    // --- User Token Editor ---
    const tokensList = document.getElementById('tokensList');
    const tokenForm = document.getElementById('token-form');
    const tokenFormTitle = document.getElementById('token-form-title');
    const regenerateWrapper = document.getElementById('regenerate-wrapper');
    const existingTokenWrapper = document.getElementById('existing-token-wrapper');
    const tokenValueDisplay = document.getElementById('token_value_display');
    let allTokens = [];

    function formatUTCDateForInput(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const pad = (num) => num.toString().padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    async function fetchTokens() {
        try {
            const data = await api('/tokens');
            allTokens = data.tokens || [];
            renderTokens();
        } catch (error) {
            alert('Error fetching tokens: ' + error.message);
        }
    }

    function renderTokens() {
        tokensList.innerHTML = allTokens.map(token => {
            const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
            const expirationText = token.expires_at 
                ? `Expires: ${new Date(token.expires_at).toLocaleString()}` 
                : 'No Expiration';
            return `
                <div>
                    <div class="command-item">
                        <div class="cmd-info">
                            <strong>${token.name}</strong> - ${token.rpm} RPM
                            <span style="color: ${token.is_enabled ? 'var(--green)' : 'var(--red)'};">
                                (${token.is_enabled ? 'Enabled' : 'Disabled'})
                            </span>
                            <br>
                            <span style="font-size: 0.8em; color: ${isExpired ? 'var(--red)' : 'var(--text-muted)'};">
                                ${expirationText}
                            </span>
                        </div>
                        <div class="cmd-actions">
                            <button class="btn-secondary" onclick="editToken(${token.id})">Edit</button>
                            <button class="btn-secondary" onclick="deleteToken(${token.id})">Delete</button>
                        </div>
                    </div>
                    <div class="token-value-wrapper">
                        <code>${token.token}</code>
                        <button class="btn-secondary" onclick="copyToClipboard('${token.token}', this)">Copy</button>
                    </div>
                </div>
            `
        }).join('');
    }

    window.editToken = (id) => {
        const token = allTokens.find(t => t.id == id);
        if (!token) return;
        tokenFormTitle.textContent = 'Edit Token';
        document.getElementById('token_id').value = token.id;
        document.getElementById('token_name').value = token.name;
        document.getElementById('token_rpm').value = token.rpm;
        document.getElementById('token_enabled').value = token.is_enabled;
        
        document.getElementById('token_expires_at').value = formatUTCDateForInput(token.expires_at);

        tokenValueDisplay.value = token.token;
        existingTokenWrapper.style.display = 'block';

        regenerateWrapper.style.display = 'block';
        document.getElementById('token_regenerate').checked = false;
    };

    window.copyTokenValue = () => {
        const button = document.querySelector('.btn-copy-token');
        copyToClipboard(tokenValueDisplay.value, button);
    };

    window.deleteToken = async (id) => {
        if (!confirm('Are you sure you want to delete this token? This action is permanent.')) return;
        try {
            await api(`/tokens/${id}`, { method: 'DELETE' });
            fetchTokens();
        } catch (error) {
            alert('Error deleting token: ' + error.message);
        }
    };

    document.getElementById('token_clear_btn').onclick = () => {
        tokenFormTitle.textContent = 'Add New Token';
        tokenForm.reset();
        document.getElementById('token_id').value = '';
        regenerateWrapper.style.display = 'none';
        existingTokenWrapper.style.display = 'none';
        document.getElementById('token_regenerate').checked = false;
        document.getElementById('token_expires_at').value = '';
    };

    tokenForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('token_id').value || null;
        const expiresAtValue = document.getElementById('token_expires_at').value;
        const expiresAtISO = expiresAtValue ? new Date(expiresAtValue).toISOString() : null;

        const body = {
            id: id,
            name: document.getElementById('token_name').value,
            rpm: parseInt(document.getElementById('token_rpm').value, 10),
            is_enabled: document.getElementById('token_enabled').value === 'true',
            regenerate: id ? document.getElementById('token_regenerate').checked : false,
            expires_at: expiresAtISO
        };

        try {
            const result = await api('/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const isNew = !id || body.regenerate;
            if (isNew) {
                alert(`Token saved successfully! The new token value is:\n\n${result.token.token}\n\nIt is also visible in the list below.`);
            } else {
                alert('Token updated successfully!');
            }

            document.getElementById('token_clear_btn').click();
            fetchTokens();
        } catch (error) {
            alert('Error saving token: ' + error.message);
        }
    };
    fetchTokens();

    // --- Custom Provider Editor ---
    const customProvidersList = document.getElementById('customProvidersList');
    const providerForm = document.getElementById('provider-form');
    const providerFormTitle = document.getElementById('provider-form-title');
    let allCustomProviders = [];

    async function fetchCustomProviders() {
        try {
            const data = await api('/custom-providers');
            allCustomProviders = data.providers || [];
            renderCustomProviders();
        } catch (error) {
            alert('Error fetching custom providers: ' + error.message);
        }
    }

    function renderCustomProviders() {
        customProvidersList.innerHTML = allCustomProviders.map(p => `
            <div class="command-item">
                <div class="cmd-info">
                    <strong>${p.display_name}</strong> (<code>/${p.provider_id}</code>)
                    <span style="color: var(--text-muted); font-size: 0.9em;">[${p.provider_type || 'openai'}]</span>
                    <span style="color: ${p.is_enabled ? 'var(--green)' : 'var(--red)'};">
                        (${p.is_enabled ? 'Enabled' : 'Disabled'})
                    </span>
                </div>
                <div class="cmd-actions">
                    <button class="btn-secondary" onclick="editCustomProvider(${p.id})">Edit</button>
                    <button class="btn-secondary" onclick="deleteCustomProvider(${p.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    window.editCustomProvider = (id) => {
        const p = allCustomProviders.find(provider => provider.id == id);
        if (!p) return;
        providerFormTitle.textContent = 'Edit Provider';
        document.getElementById('provider_id_hidden').value = p.id;
        document.getElementById('provider_type').value = p.provider_type || 'openai';
        document.getElementById('provider_display_name').value = p.display_name;
        document.getElementById('provider_id_input').value = p.provider_id;
        document.getElementById('provider_api_base_url').value = p.api_base_url;
        document.getElementById('provider_model_id').value = p.model_id;
        document.getElementById('provider_enforced_model_name').value = p.enforced_model_name || '';
        document.getElementById('provider_model_display_name').value = p.model_display_name || '';
        document.getElementById('provider_max_context_tokens').value = p.max_context_tokens || '';
        document.getElementById('provider_max_output_tokens').value = p.max_output_tokens || '';
        document.getElementById('provider_api_keys').value = p.api_keys || '';
        document.getElementById('provider_enabled').value = p.is_enabled;
    };

    window.deleteCustomProvider = async (id) => {
        if (!confirm('Are you sure you want to delete this provider? This will remove its endpoint immediately.')) return;
        try {
            await api(`/custom-providers/${id}`, { method: 'DELETE' });
            fetchCustomProviders();
            alert('Provider deleted. Please RESTART the server for the changes to fully apply.');
        } catch (error) {
            alert('Error deleting provider: ' + error.message);
        }
    };

    document.getElementById('provider_clear_btn').onclick = () => {
        providerFormTitle.textContent = 'Add New Provider';
        providerForm.reset();
        document.getElementById('provider_id_hidden').value = '';
    };

    providerForm.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
            id: document.getElementById('provider_id_hidden').value || null,
            provider_type: document.getElementById('provider_type').value,
            display_name: document.getElementById('provider_display_name').value,
            provider_id: document.getElementById('provider_id_input').value,
            api_base_url: document.getElementById('provider_api_base_url').value,
            model_id: document.getElementById('provider_model_id').value,
            enforced_model_name: document.getElementById('provider_enforced_model_name').value.trim() || null,
            model_display_name: document.getElementById('provider_model_display_name').value,
            max_context_tokens: document.getElementById('provider_max_context_tokens').value || null,
            max_output_tokens: document.getElementById('provider_max_output_tokens').value || null,
            api_keys: document.getElementById('provider_api_keys').value,
            is_enabled: document.getElementById('provider_enabled').value === 'true',
        };

        try {
            await api('/custom-providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            alert('Provider saved successfully! Please RESTART the server for the changes to fully apply.');
            document.getElementById('provider_clear_btn').click();
            fetchCustomProviders();
        } catch (error) {
            alert('Error saving provider: ' + error.message);
        }
    };
    fetchCustomProviders();

    // --- Logs Manager ---
    const logsTable = document.getElementById('logsTable');
    const logsPagination = document.getElementById('logsPagination');
    const logSettingsForm = document.getElementById('log-settings-form');
    const purgeHoursWrapper = document.getElementById('purge-hours-wrapper');
    const logSettingOptions = document.querySelectorAll('.log-setting-option');
    let currentPage = 1;

    async function fetchLogs(page = 1) {
        try {
            currentPage = page;
            const data = await api(`/logs?page=${page}&limit=20`);
            renderLogs(data.logs);
            renderPagination(data.total, page, 20);
        } catch (error) {
            showAlert('Error fetching logs: ' + error.message, true);
        }
    }

    function renderLogs(logs) {
        if (logs.length === 0) {
            logsTable.innerHTML = '<p class="muted">No logs found.</p>';
            return;
        }
        logsTable.innerHTML = `
            <div class="log-row header">
                <div>Status</div>
                <div>Character</div>
                <div>Commands</div>
                <div class="mobile-hidden">Provider</div>
                <div class="mobile-hidden">Token Name</div>
                <div>Timestamp</div>
                <div>Actions</div>
            </div>
            ${logs.map(log => `
                <div class="log-row">
                    <div><span class="status-code s-${String(log.status_code).charAt(0)}">${log.status_code}</span></div>
                    <div>${log.character_name || 'N/A'}</div>
                    <div class="mobile-hidden">${log.detected_commands || 'None'}</div>
                    <div class="mobile-hidden">${log.provider}</div>
                    <div class="mobile-hidden">${log.token_name}</div>
                    <div>${new Date(log.created_at).toLocaleString()}</div>
                    <div class="log-actions">
                        <button class="btn-secondary" onclick="viewLogDetails(${log.id})">Details</button>
                        <button class="btn-secondary" onclick="deleteLog(${log.id})">Delete</button>
                    </div>
                </div>
            `).join('')}
        `;
    }

    function renderPagination(total, page, limit) {
        const totalPages = Math.ceil(total / limit);
        logsPagination.innerHTML = '';
        if (totalPages <= 1) return;

        for (let i = 1; i <= totalPages; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.textContent = i;
            pageBtn.className = (i === page) ? 'active' : '';
            pageBtn.onclick = () => fetchLogs(i);
            logsPagination.appendChild(pageBtn);
        }
    }
    
    window.deleteLog = async (id) => {
        if (!confirm('Are you sure you want to delete this log?')) return;
        try {
            await api(`/logs/${id}`, { method: 'DELETE' });
            fetchLogs(currentPage);
        } catch (error) {
            showAlert('Error deleting log: ' + error.message, true);
        }
    };

    document.getElementById('deleteAllLogsBtn').onclick = async () => {
        if (!confirm('Are you sure you want to delete ALL logs? This action is irreversible.')) return;
        try {
            await api('/logs', { method: 'DELETE' });
            fetchLogs(1);
        } catch (error) {
            showAlert('Error deleting all logs: ' + error.message, true);
        }
    };

    function togglePurgeHoursVisibility() {
        const selectedRadio = document.querySelector('input[name="log_mode"]:checked');
        const selectedMode = selectedRadio ? selectedRadio.value : null;
        purgeHoursWrapper.style.display = selectedMode === 'auto_purge' ? 'block' : 'none';
    }

    async function fetchLogSettings() {
        try {
            const settings = await api('/logging-settings');
            const mode = settings.logging_mode || 'disabled';
            
            const radioToSelect = document.getElementById(`log-${mode}`);
            if (radioToSelect) radioToSelect.checked = true;
            
            logSettingOptions.forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === mode);
            });

            document.getElementById('log_purge_hours').value = settings.logging_purge_hours || 24;
            
            togglePurgeHoursVisibility();
        } catch (error) {
            showAlert('Error fetching log settings: ' + error.message, true);
        }
    }

    logSettingOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const radio = document.getElementById(`log-${value}`);
            if (radio) radio.checked = true;
            
            logSettingOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            togglePurgeHoursVisibility();
        });
    });

    logSettingsForm.onsubmit = async (e) => {
        e.preventDefault();
        const mode = document.querySelector('input[name="log_mode"]:checked').value;
        const purgeHours = document.getElementById('log_purge_hours').value;
        try {
            await api('/logging-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, purgeHours: parseInt(purgeHours, 10) })
            });
            showAlert('Log settings saved successfully!');
        } catch (error) {
            showAlert('Error saving settings: ' + error.message, true);
        }
    };

    const modal = document.getElementById('logDetailModal');
    const closeBtn = document.querySelector('.modal .close-button');
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    window.viewLogDetails = async (id) => {
        try {
            const log = await api(`/logs/${id}`);
            document.getElementById('logRequestPayload').textContent = JSON.stringify(log.request_payload, null, 2);
            document.getElementById('logResponsePayload').textContent = JSON.stringify(log.response_payload, null, 2);
            modal.style.display = 'block';
        } catch (error) {
            showAlert('Error fetching log details: ' + error.message, true);
        }
    };

    const logsTabLink = document.querySelector('a[data-tab="logs"]');
    logsTabLink.addEventListener('click', () => {
        fetchLogs(1);
        fetchLogSettings();
    });
    
    // --- NEW: Announcement Tab Logic ---
    const announcementForm = document.getElementById('announcement-form');

    async function fetchAnnouncement() {
        try {
            const data = await api('/announcement');
            document.getElementById('announce_message').value = data.message;
            document.getElementById('announce_enabled').value = data.enabled;
        } catch (error) {
            showAlert('Failed to fetch announcement settings: ' + error.message, true);
        }
    }

    const announceTabLink = document.querySelector('a[data-tab="announce"]');
    announceTabLink.addEventListener('click', () => {
        fetchAnnouncement();
    });

    announcementForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            message: document.getElementById('announce_message').value,
            enabled: document.getElementById('announce_enabled').value === 'true'
        };
        try {
            await api('/announcement', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            showAlert('Announcement saved successfully!');
        } catch (error) {
            showAlert('Failed to save announcement: ' + error.message, true);
        }
    });

    // --- Import/Export ---
    document.getElementById('exportBtn').onclick = () => {
        const provider = document.getElementById('exportProviderSelector').value;
        window.location.href = `/admin/api/export?provider=${provider}`;
    };

    document.getElementById('importBtn').onclick = async () => {
        const fileInput = document.getElementById('importFile');
        if (fileInput.files.length === 0) return alert('Please select a file to import.');

        const provider = document.getElementById('importProviderSelector').value;
        if (!provider) return alert('Please select a provider to import the configuration to.');

        const formData = new FormData();
        formData.append('configFile', fileInput.files[0]);
        
        try {
            const result = await fetch(`/admin/api/import?provider=${provider}`, { method: 'POST', body: formData });
            const data = await result.json();
            if (!result.ok) throw new Error(data.detail || data.error);
            
            alert(data.message);
            fileInput.value = '';
            fetchStructure(providerSelector.value);
            fetchCommands();
        } catch (error) {
            alert('Import failed: ' + error.message);
        }
    };
});