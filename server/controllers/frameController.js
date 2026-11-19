const frame = require('../services/frameService');
const { passClientError } = require('../utils/httpError');

const MAX_INFO_SECONDS = 600;

// The server's side of the frame: an event stream the screen listens to, and
// commands other services (Home Assistant, say) send to it
class FrameController {
  events(req, res) {
    return frame.addClient(req, res);
  }

  async state(req, res) {
    try {
      res.json({ success: true, ...await frame.state() });
    } catch (error) {
      if (passClientError(res, error)) return;
      console.error('Error reading frame state:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  next(req, res) {
    res.json({ success: true, frames: frame.broadcast('next') });
  }

  // Shows the info overlay on the frame for a few seconds (/control/info/10, default 5)
  info(req, res) {
    const seconds = req.params.seconds === undefined ? 5 : Number(req.params.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_INFO_SECONDS) {
      return res.status(400).json({ success: false, message: `seconds must be between 1 and ${MAX_INFO_SECONDS}`, code: 'INVALID_SECONDS' });
    }
    res.json({ success: true, frames: frame.broadcast('info', { seconds }) });
  }

  async account(req, res) {
    try {
      const account = await frame.findAccount(req.params.account);
      if (!account) {
        return res.status(404).json({ success: false, message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' });
      }
      await frame.setActiveAccount(account);
      res.json({ success: true, ...frame.describe(account), frames: frame.clients.size });
    } catch (error) {
      if (passClientError(res, error)) return;
      console.error('Error switching account:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = new FrameController();
