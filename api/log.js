const { logHandler } = require('./_lib/core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  // Fire-and-forget telemetry: logHandler never throws and never reports a
  // failure back to the caller — always 204, whether the row was written,
  // Supabase isn't configured, or the write failed.
  await logHandler(req.body);
  res.status(204).end();
};
