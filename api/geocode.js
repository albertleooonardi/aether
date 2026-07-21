const { geocodeHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  const { q, near, limit } = req.query || {};
  const { status, body } = await geocodeHandler(q, near, limit);
  res.status(status).json(body);
};
