const { usageHandler } = require('./_lib/core');

module.exports = (req, res) => {
  const { status, body } = usageHandler();
  res.status(status).json(body);
};
