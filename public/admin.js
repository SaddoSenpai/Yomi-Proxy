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

    // --- Helper function for copying text ---
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
    fetchStats();
    setInterval(fetchStats, 5000);

    // --- Structure Editor ---
    const providerSelector = document.getElementById('providerSelector');
    const blocksList = document.getElementById('blocksList');
    let currentBlocks = [];
    let pristineBlocks = '[]';
    let currentlyEditingIndex = -1;

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
            const isInjection = ['Jailbreak', 'Additional Commands', 'Prefill'].includes(block.block_type);
            
            const el = document.createElement('div');
            el.className = `block-item ${isEditing ? 'is-editing' : ''} ${isInjection ? 'is-injection-point' : ''}`;
            el.innerHTML = `
                <div class="block-header">
                    <div class="block-info">
                        <span class="block-name">${block.name || 'Unnamed Block'}</span>
                        <span class="block-role">(${block.role}) ${isInjection ? '[Injection Point]' : ''}</span>
                    </div>
                    <div class="block-actions">
                        <button class="btn-secondary" onclick="toggleEdit(${index})">${isEditing ? 'Cancel' : 'Edit'}</button>
                        <button class="btn-secondary" style="background-color: var(--red);" onclick="deleteBlock(${index})">Delete</button>
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
                    </select>
                    <textarea class="edit-content" placeholder="Block content..." ${isInjection ? 'disabled' : ''}>${block.content || ''}</textarea>
                    <div class="action-buttons">
                        <button class="btn-primary" onclick="saveBlockEdit(${index})">Save Changes</button>
                    </div>
                </div>
            `;
            blocksList.appendChild(el);
        });
    }

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
        currentlyEditingIndex = -1;
        renderBlocks();
        updateSaveButtonState();
    };

    document.getElementById('addBlockBtn').onclick = () => {
        currentBlocks.push({ name: 'New Block', role: 'system', content: '', is_enabled: true, block_type: 'Standard' });
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
        tokensList.innerHTML = allTokens.map(token => `
            <div>
                <div class="command-item">
                    <div class="cmd-info">
                        <strong>${token.name}</strong> - ${token.rpm} RPM
                        <span style="color: ${token.is_enabled ? 'var(--green)' : 'var(--red)'};">
                            (${token.is_enabled ? 'Enabled' : 'Disabled'})
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
        `).join('');
    }

    window.editToken = (id) => {
        const token = allTokens.find(t => t.id == id);
        if (!token) return;
        tokenFormTitle.textContent = 'Edit Token';
        document.getElementById('token_id').value = token.id;
        document.getElementById('token_name').value = token.name;
        document.getElementById('token_rpm').value = token.rpm;
        document.getElementById('token_enabled').value = token.is_enabled;
        
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
    };

    tokenForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('token_id').value || null;
        const body = {
            id: id,
            name: document.getElementById('token_name').value,
            rpm: parseInt(document.getElementById('token_rpm').value, 10),
            is_enabled: document.getElementById('token_enabled').value === 'true',
            regenerate: id ? document.getElementById('token_regenerate').checked : false
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
        document.getElementById('provider_display_name').value = p.display_name;
        document.getElementById('provider_id_input').value = p.provider_id;
        document.getElementById('provider_api_base_url').value = p.api_base_url;
        document.getElementById('provider_model_id').value = p.model_id;
        // --- MODIFIED: Populate the new field ---
        document.getElementById('provider_enforced_model_name').value = p.enforced_model_name || '';
        document.getElementById('provider_model_display_name').value = p.model_display_name || '';
        document.getElementById('provider_api_keys').value = p.api_keys || '';
        document.getElementById('provider_enabled').value = p.is_enabled;
    };

    window.deleteCustomProvider = async (id) => {
        if (!confirm('Are you sure you want to delete this provider? This will remove its endpoint immediately.')) return;
        try {
            await api(`/custom-providers/${id}`, { method: 'DELETE' });
            fetchCustomProviders();
            alert('Provider deleted. Please REFRESH the page for the changes to fully apply.');
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
            display_name: document.getElementById('provider_display_name').value,
            provider_id: document.getElementById('provider_id_input').value,
            api_base_url: document.getElementById('provider_api_base_url').value,
            model_id: document.getElementById('provider_model_id').value,
            // --- MODIFIED: Send the new field to the backend ---
            enforced_model_name: document.getElementById('provider_enforced_model_name').value.trim() || null, // Send null if empty
            model_display_name: document.getElementById('provider_model_display_name').value,
            api_keys: document.getElementById('provider_api_keys').value,
            is_enabled: document.getElementById('provider_enabled').value === 'true',
        };

        try {
            await api('/custom-providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            alert('Provider saved successfully! Please REFRESH the page for the changes to fully apply.');
            document.getElementById('provider_clear_btn').click();
            fetchCustomProviders();
        } catch (error) {
            alert('Error saving provider: ' + error.message);
        }
    };
    fetchCustomProviders();

    // --- Import/Export ---
    document.getElementById('exportBtn').onclick = () => {
        const provider = document.getElementById('exportProviderSelector').value;
        window.location.href = `/admin/api/export?provider=${provider}`;
    };

    document.getElementById('importBtn').onclick = async () => {
        const fileInput = document.getElementById('importFile');
        if (fileInput.files.length === 0) return alert('Please select a file to import.');

        // --- MODIFIED: Get target provider and send as query param ---
        const provider = document.getElementById('importProviderSelector').value;
        if (!provider) return alert('Please select a provider to import the configuration to.');

        const formData = new FormData();
        formData.append('configFile', fileInput.files[0]);
        
        try {
            const result = await fetch(`/admin/api/import?provider=${provider}`, { method: 'POST', body: formData });
            const data = await result.json();
            if (!result.ok) throw new Error(data.detail || data.error);
            
            alert(data.message);
            fileInput.value = ''; // Clear the file input
            fetchStructure(providerSelector.value); // Refresh structure view
            fetchCommands(); // Refresh commands
        } catch (error) {
            alert('Import failed: ' + error.message);
        }
    };
});