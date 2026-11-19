const frame = require('../services/frameService');

// Puts the account the server is playing on the request, so folders and notes
// can be limited to what that account may see (see utils/viewerAccess)
async function activeAccount(req, res, next) {
  try {
    req.activeAccount = await frame.activeAccount();
    next();
  } catch (error) {
    next(error);
  }
}

// Any change (accounts created, edited or deleted) means looking the account up again next time
function invalidateOnChange(req, res, next) {
  if (req.method !== 'GET') res.on('finish', () => frame.invalidate());
  next();
}

module.exports = activeAccount;
module.exports.invalidateOnChange = invalidateOnChange;
