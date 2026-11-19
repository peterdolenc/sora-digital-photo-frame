const { getDataStore } = require('../store');
const accessAccounts = require('../controllers/accessAccountController');

const STATE_FILE = 'frame-state';
const HEARTBEAT_MS = 25 * 1000;
// Every request asks for the active account; look it up at most this often
const ACCOUNT_CACHE_MS = 1000;

/**
 * The one screen this server plays on. The server decides which access
 * account it shows (its folders limit the photos), remembers it across
 * restarts, and tells open frames what to do through a server-sent event
 * stream: next, info, account.
 */
class FrameService {
  constructor() {
    this.clients = new Set();
    this.cached = null; // { at, account }
  }

  invalidate() {
    this.cached = null;
  }

  // The account being played: the saved one, else the first account, else none (all photos)
  async activeAccount() {
    if (this.cached && Date.now() - this.cached.at < ACCOUNT_CACHE_MS) return this.cached.account;
    const account = await this.lookUpActiveAccount();
    this.cached = { at: Date.now(), account };
    return account;
  }

  async lookUpActiveAccount() {
    const accounts = await accessAccounts.loadAccounts();
    const { accountId } = await getDataStore().get(STATE_FILE, {});
    return accounts.find(account => account.id === accountId) || accounts[0] || null;
  }

  // An account by id or (any case) name
  async findAccount(idOrName) {
    const wanted = String(idOrName ?? '').trim().toLowerCase();
    if (!wanted) return null;
    const accounts = await accessAccounts.loadAccounts();
    return accounts.find(account => account.id === idOrName)
      || accounts.find(account => String(account.name).toLowerCase() === wanted)
      || null;
  }

  async setActiveAccount(account) {
    await getDataStore().set(STATE_FILE, { accountId: account.id });
    this.invalidate();
    this.broadcast('account', this.describe(account));
    return account;
  }

  describe(account) {
    return { accountId: account?.id || null, accountName: account?.name || null };
  }

  async state() {
    const accounts = await accessAccounts.loadAccounts();
    const active = await this.activeAccount();
    return {
      ...this.describe(active),
      accounts: accounts.map(({ id, name }) => ({ id, name })),
      frames: this.clients.size
    };
  }

  // Opens the event stream for a frame; it starts with the current account
  async addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no' // nginx: don't hold the stream back
    });
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
    this.send(res, 'state', this.describe(await this.activeAccount()));
  }

  send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  }

  // Tells every open frame; returns how many were told
  broadcast(event, data) {
    for (const res of this.clients) this.send(res, event, data);
    return this.clients.size;
  }
}

module.exports = new FrameService();
