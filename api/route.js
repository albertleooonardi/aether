const { routeHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  const { from, to } = req.query || {};
  const { status, body } = await routeHandler(from, to);
  res.status(status).json(body);
};
