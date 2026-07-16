const { healthHandler } = require('./_lib/core');

module.exports = (req, res) => {
  const { status, body } = healthHandler();
  res.status(status).json(body);
};
