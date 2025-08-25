// public/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    const sidebarBtn = document.querySelector('.sidebarBtn');
    const navLinks = document.querySelectorAll('.nav-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const dashboardTitle = document.querySelector('.dashboard-title');
    const overlay = document.querySelector('.overlay'); // Get the overlay

    // --- MODIFIED: Implement sliding sidebar logic for mobile view ---
    sidebarBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            // On mobile, toggle the 'open' class for sliding
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        } else {
            // On desktop, toggle the 'close' class for collapsing
            sidebar.classList.toggle('close');
        }
    });

    // Close mobile sidebar when overlay is clicked
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });

    // --- Navigation ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = link.dataset.tab;

            navLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(t => t.classList.remove('active'));

            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            dashboardTitle.textContent = link.querySelector('.link_name').textContent;

            // Close sidebar after clicking a link on mobile
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            }
        });
    });

    // --- API Helper ---
    async function api(path, opts = {}) {
        const response = await fetch('/admin/api' + path, opts);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || error.error || 'API request failed');
        }
        return response.status === 204 ? null : response.json();
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

    // --- Command Editor (Unchanged) ---
    const commandsList = document.getElementById('commandsList');
    const commandForm = document.getElementById('command-form');
    const formTitle = document.getElementById('command-form-title');
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
                    <button class="btn-secondary" data-id="${cmd.id}" onclick="editCommand(this)">Edit</button>
                    <button class="btn-secondary" data-id="${cmd.id}" onclick="deleteCommand(this)">Delete</button>
                </div>
            </div>
        `).join('');
    }

    window.editCommand = (btn) => {
        const cmd = allCommands.find(c => c.id == btn.dataset.id);
        if (!cmd) return;
        formTitle.textContent = 'Edit Command';
        document.getElementById('cmd_id').value = cmd.id;
        document.getElementById('cmd_tag').value = cmd.command_tag;
        document.getElementById('cmd_name').value = cmd.block_name;
        document.getElementById('cmd_role').value = cmd.block_role;
        document.getElementById('cmd_type').value = cmd.command_type;
        document.getElementById('cmd_content').value = cmd.block_content;
    };

    window.deleteCommand = async (btn) => {
        if (!confirm('Are you sure you want to delete this command?')) return;
        try {
            await api(`/commands/${btn.dataset.id}`, { method: 'DELETE' });
            fetchCommands();
        } catch (error) {
            alert('Error deleting command: ' + error.message);
        }
    };

    document.getElementById('cmd_clear_btn').onclick = () => {
        formTitle.textContent = 'Add New Command';
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

    // --- Import/Export (Unchanged) ---
    document.getElementById('exportBtn').onclick = () => {
        const provider = document.getElementById('exportProviderSelector').value;
        window.location.href = `/admin/api/export?provider=${provider}`;
    };

    document.getElementById('importBtn').onclick = async () => {
        const fileInput = document.getElementById('importFile');
        if (fileInput.files.length === 0) return alert('Please select a file to import.');
        const formData = new FormData();
        formData.append('configFile', fileInput.files[0]);
        try {
            const result = await fetch('/admin/api/import', { method: 'POST', body: formData });
            const data = await result.json();
            if (!result.ok) throw new Error(data.detail || data.error);
            alert(data.message);
            fetchStructure(providerSelector.value);
            fetchCommands();
        } catch (error) {
            alert('Import failed: ' + error.message);
        }
    };
});