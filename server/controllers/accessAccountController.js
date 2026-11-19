const { getDataStore } = require('../store');
const { passClientError } = require('../utils/httpError');

/**
 * Accounts: a name and the folders it may show. The server plays one account
 * at a time (see services/frameService); an account with no folders shows everything.
 */
class AccessAccountController {
    async loadAccounts() {
        const accounts = await getDataStore().get('access-accounts', []);
        // Accounts saved when they had PINs: the PIN and its bookkeeping are dropped
        return accounts.map(({ pin, pinHash, lastAccessed, ...account }) => account);
    }

    async saveAccounts(accounts) {
        await getDataStore().set('access-accounts', accounts);
    }

    generateAccountId() {
        return 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async getAllAccounts(req, res) {
        try {
            res.json({ accounts: await this.loadAccounts() });
        } catch (error) {
            if (passClientError(res, error)) return;
            console.error('Error fetching accounts:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch accounts'
            });
        }
    }

    async createAccount(req, res) {
        try {
            const { name, assignedFolders = [] } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: 'Name is required'
                });
            }

            const account = {
                id: this.generateAccountId(),
                name,
                assignedFolders,
                createdAt: new Date().toISOString()
            };
            await getDataStore().update('access-accounts', [], accounts => [...accounts, account]);

            res.status(201).json({ success: true, account });
        } catch (error) {
            if (passClientError(res, error)) return;
            console.error('Error creating account:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create account'
            });
        }
    }

    async updateAccount(req, res) {
        try {
            const { id } = req.params;
            const { name, assignedFolders = [] } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: 'Name is required'
                });
            }

            let updatedAccount;
            await getDataStore().update('access-accounts', [], accounts => accounts.map(({ pin, pinHash, lastAccessed, ...account }) => {
                if (account.id !== id) return account;
                updatedAccount = { ...account, name, assignedFolders };
                return updatedAccount;
            }));
            if (!updatedAccount) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found',
                    code: 'ACCOUNT_NOT_FOUND'
                });
            }

            res.json({ success: true, account: updatedAccount });
        } catch (error) {
            if (passClientError(res, error)) return;
            console.error('Error updating account:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update account'
            });
        }
    }

    async deleteAccount(req, res) {
        try {
            const { id } = req.params;
            if (!(await this.loadAccounts()).some(account => account.id === id)) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found',
                    code: 'ACCOUNT_NOT_FOUND'
                });
            }

            await getDataStore().update('access-accounts', [], accounts => accounts.filter(account => account.id !== id));

            res.json({
                success: true,
                message: 'Account deleted successfully'
            });
        } catch (error) {
            if (passClientError(res, error)) return;
            console.error('Error deleting account:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete account'
            });
        }
    }
}

module.exports = new AccessAccountController();
