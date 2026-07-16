const { resolveHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  const { url } = req.query || {};
  const { status, body } = await resolveHandler(url);
  res.status(status).json(body);
};
