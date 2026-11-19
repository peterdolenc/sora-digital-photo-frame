class AccessAccountsManager {
    constructor() {
        this.accounts = [];
        this.folders = [];
        this.currentEditingAccount = null;
        this.init();
    }

    init() {
        this.bindEvents();
        // Re-render what this page builds itself when the language changes
        window.addEventListener('sora:languagechange', () => {
            if (this.loaded) this.renderAccounts();
            this.renderDeleteDescription();
            if (document.getElementById('accountModal').open) this.renderModalText();
        });
        this.loadAccounts();
        this.loadFolders();
    }

    bindEvents() {
        // Back button
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = '/admin.html';
        });

        // Create new account button
        document.getElementById('createAccountBtn').addEventListener('click', () => {
            this.openAccountModal();
        });

        // Modal events
        document.getElementById('cancelAccountBtn').addEventListener('click', () => {
            this.closeAccountModal();
        });

        document.getElementById('closeAccountModal').addEventListener('click', () => {
            this.closeAccountModal();
        });

        document.getElementById('accountForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAccount();
        });

        // Delete modal events
        document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
            this.closeDeleteModal();
        });

        document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
            this.deleteAccount();
        });

        // Form validation
        document.getElementById('accountName').addEventListener('input', (e) => {
            this.validateName(e.target.value);
        });
    }

    async loadAccounts() {
        try {
            this.showLoading();
            const response = await fetch('/api/access-accounts');
            const data = await response.json();
            
            if (response.ok) {
                this.accounts = data.accounts || [];
                this.renderAccounts();
            } else {
                this.showToast(t('accessAccounts.loadFailed'), 'error');
                this.showEmptyState();
            }
        } catch (error) {
            console.error('Error loading accounts:', error);
            this.showToast(t('accessAccounts.loadFailed'), 'error');
            this.showEmptyState();
        }
    }

    async loadFolders() {
        try {
            const response = await fetch('/api/folders');
            const data = await response.json();
            
            if (response.ok && data.folders) {
                this.folders = data.folders.map(folder => ({
                    name: folder.name,
                    path: folder.path || folder.name,
                    imageCount: folder.imageCount || 0
                }));
            } else {
                this.folders = [];
            }
        } catch (error) {
            console.error('Error loading folders:', error);
            this.folders = [];
        }
    }

    showLoading() {
        document.getElementById('loadingState').classList.remove('hidden');
        document.getElementById('accountsList').classList.add('hidden');
        document.getElementById('emptyState').classList.add('hidden');
    }

    showEmptyState() {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('accountsList').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }

    renderAccounts() {
        document.getElementById('loadingState').classList.add('hidden');
        this.loaded = true;

        const meta = document.getElementById('accountsMetaText');
        if (meta) {
            const count = this.accounts.length;
            meta.textContent = count === 0
                ? t('accessAccounts.no_accounts')
                : t('accessAccounts.accounts', { count });
        }
        
        if (this.accounts.length === 0) {
            this.showEmptyState();
            return;
        }

        document.getElementById('emptyState').classList.add('hidden');
        const accountsList = document.getElementById('accountsList');
        accountsList.classList.remove('hidden');
        
        accountsList.innerHTML = this.accounts.map(account => this.renderAccountCard(account)).join('');
        
        // Bind account action events
        this.bindAccountActions();
    }

    escapeHtml(value) {
        // Quotes too, so the result is also safe inside an attribute (data-folder="...")
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    renderAccountCard(account) {
        const esc = (value) => this.escapeHtml(value);
        const folderTags = account.assignedFolders.length > 0
            ? account.assignedFolders.map(folder =>
                `<span class="folder-tag">
                    <span class="material-symbols-outlined">folder</span>
                    ${esc(folder)}
                </span>`).join('')
            : `<span class="folder-tag no-folders-tag">${esc(t('accessAccounts.noFoldersAssigned'))}</span>`;

        const folderCount = account.assignedFolders.length;

        return `
            <article class="account-card" data-account-id="${esc(account.id)}">
                <div class="account-top">
                    <div class="account-avatar" aria-hidden="true">${esc(account.name.trim().charAt(0).toUpperCase() || '?')}</div>
                    <div class="account-heading">
                        <h3 class="account-name">${esc(account.name)}</h3>
                    </div>
                    <div class="account-actions">
                        <button class="tb-btn icon edit-account" title="${esc(t('accessAccounts.editAccount'))}" data-account-id="${esc(account.id)}">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button class="tb-btn icon delete-account" data-danger title="${esc(t('accessAccounts.deleteAccount'))}" data-account-id="${esc(account.id)}">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
                <dl class="account-stats">
                    <div><dt>${esc(t('accessAccounts.statFolders'))}</dt><dd>${folderCount === 0 ? esc(t('accessAccounts.statFoldersNone')) : folderCount}</dd></div>
                </dl>
                <div class="folder-tags">
                    ${folderTags}
                </div>
            </article>
        `;
    }

    bindAccountActions() {
        // Edit account buttons
        document.querySelectorAll('.edit-account').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const accountId = e.currentTarget.getAttribute('data-account-id');
                this.editAccount(accountId);
            });
        });

        // Delete account buttons
        document.querySelectorAll('.delete-account').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const accountId = e.currentTarget.getAttribute('data-account-id');
                this.confirmDeleteAccount(accountId);
            });
        });
    }

    openAccountModal(account = null) {
        this.currentEditingAccount = account;
        const modal = document.getElementById('accountModal');
        const form = document.getElementById('accountForm');
        
        if (account) {
            document.getElementById('accountName').value = account.name;
        } else {
            form.reset();
        }
        this.renderModalText();

        this.clearErrors();
        this.renderFolderGrid(account ? account.assignedFolders : []);
        modal.showModal();
        document.getElementById('accountName').focus();
    }

    // The title depends on whether an account is being edited
    renderModalText() {
        const editing = Boolean(this.currentEditingAccount);
        document.getElementById('modalTitle').textContent = t(editing ? 'accessAccounts.editAccountTitle' : 'accessAccounts.static_007');
    }

    closeAccountModal() {
        document.getElementById('accountModal').close();
        this.currentEditingAccount = null;
    }

    renderFolderGrid(selectedFolders = []) {
        const loadingElement = document.getElementById('loadingFolders');
        const gridElement = document.getElementById('folderGrid');
        
        if (this.folders.length === 0) {
            loadingElement.classList.remove('hidden');
            gridElement.classList.add('hidden');
            return;
        }

        loadingElement.classList.add('hidden');
        gridElement.classList.remove('hidden');
        
        const esc = (value) => this.escapeHtml(value);
        gridElement.innerHTML = this.folders.map(folder => {
            const isSelected = selectedFolders.includes(folder.name);
            return `
                <div class="folder-item ${isSelected ? 'selected' : ''}" data-folder="${esc(folder.name)}">
                    <label class="label flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" 
                               class="input"
                               id="folder-${esc(folder.name)}" 
                               value="${esc(folder.name)}" 
                               ${isSelected ? 'checked' : ''}>
                        <div class="flex items-center gap-2 flex-1">
                            <span class="material-symbols-outlined">folder</span>
                            <span class="font-medium">${esc(folder.name)}</span>
                            <span class="text-sm text-muted-foreground ml-auto">${folder.imageCount}</span>
                        </div>
                    </label>
                </div>
            `;
        }).join('');

        // Bind folder checkbox events
        gridElement.querySelectorAll('.folder-item').forEach(folderItem => {
            const checkbox = folderItem.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    folderItem.classList.add('selected');
                } else {
                    folderItem.classList.remove('selected');
                }
            });
        });
    }

    async saveAccount() {
        if (!this.validateForm()) {
            return;
        }

        const formData = new FormData(document.getElementById('accountForm'));
        const selectedFolders = Array.from(document.querySelectorAll('#folderGrid input[type="checkbox"]:checked'))
            .map(input => input.value);

        const accountData = {
            name: formData.get('name'),
            assignedFolders: selectedFolders
        };

        try {
            const url = this.currentEditingAccount 
                ? `/api/access-accounts/${this.currentEditingAccount.id}`
                : '/api/access-accounts';
            
            const method = this.currentEditingAccount ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(accountData)
            });

            const data = await response.json();

            if (response.ok) {
                this.showToast(
                    t(this.currentEditingAccount ? 'accessAccounts.accountUpdated' : 'accessAccounts.accountCreated'),
                    'success'
                );
                this.closeAccountModal();
                this.loadAccounts();
            } else {
                this.showToast(i18n.error(data, 'accessAccounts.saveFailed'), 'error');
            }
        } catch (error) {
            console.error('Error saving account:', error);
            this.showToast(t('accessAccounts.saveFailed'), 'error');
        }
    }

    editAccount(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (account) {
            this.openAccountModal(account);
        }
    }

    confirmDeleteAccount(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (account) {
            this.deletingName = account.name;
            this.renderDeleteDescription();
            document.getElementById('confirmDeleteBtn').setAttribute('data-account-id', accountId);
            document.getElementById('deleteModal').showModal();
        }
    }

    // One whole sentence with the account name inside it
    renderDeleteDescription() {
        if (this.deletingName == null) return;
        document.getElementById('delete-description').innerHTML =
            t('accessAccounts.deleteConfirm', { name: this.escapeHtml(this.deletingName) });
    }

    async deleteAccount() {
        const accountId = document.getElementById('confirmDeleteBtn').getAttribute('data-account-id');
        
        try {
            const response = await fetch(`/api/access-accounts/${accountId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showToast(t('accessAccounts.accountDeleted'), 'success');
                this.closeDeleteModal();
                this.loadAccounts();
            } else {
                const data = await response.json();
                this.showToast(i18n.error(data, 'accessAccounts.deleteFailed'), 'error');
            }
        } catch (error) {
            console.error('Error deleting account:', error);
            this.showToast(t('accessAccounts.deleteFailed'), 'error');
        }
    }

    closeDeleteModal() {
        document.getElementById('deleteModal').close();
    }

    validateForm() {
        return this.validateName(document.getElementById('accountName').value.trim());
    }

    validateName(name) {
        const nameInput = document.getElementById('accountName');
        const errorElement = document.getElementById('nameError');
        
        if (!name) {
            this.showError('nameError', t('accessAccounts.nameRequired'));
            nameInput.classList.add('error');
            return false;
        }
        
        if (name.length > 50) {
            this.showError('nameError', t('accessAccounts.nameTooLong'));
            nameInput.classList.add('error');
            return false;
        }

        this.clearError('nameError');
        nameInput.classList.remove('error');
        return true;
    }

    showError(elementId, message) {
        document.getElementById(elementId).textContent = message;
    }

    clearError(elementId) {
        document.getElementById(elementId).textContent = '';
    }

    clearErrors() {
        this.clearError('nameError');
        document.getElementById('accountName').classList.remove('error');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="material-icons">
                ${type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info'}
            </span>
            <span class="toast-message"></span>
        `;
        // Messages can include server text, so never parse them as HTML
        toast.querySelector('.toast-message').textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                container.removeChild(toast);
            }, 300);
        }, 3000);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AccessAccountsManager();
});
