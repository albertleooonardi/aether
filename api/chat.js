const { chatHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const { status, body } = await chatHandler(req.body);
  res.status(status).json(body);
};
