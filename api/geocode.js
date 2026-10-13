const { geocodeHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  const { q, near, limit, mode } = req.query || {};
  const { status, body } = await geocodeHandler(q, near, limit, mode);
  res.status(status).json(body);
};
