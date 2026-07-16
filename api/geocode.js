const { geocodeHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  const { q, near } = req.query || {};
  const { status, body } = await geocodeHandler(q, near);
  res.status(status).json(body);
};
