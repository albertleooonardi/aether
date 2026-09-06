const { chatMemoryWriteHandler, chatMemoryReadHandler, chatMemoryDeleteHandler } = require('./_lib/core');

// Durable chat memory, one route for all three verbs (mirrors how the
// widget's Trash button and message persistence share one client_id):
//   POST   { client_id, role, text } — persist one turn
//   GET    ?client_id=...            — recent transcript, oldest-first
//   DELETE ?client_id=...            — wipe a client's transcript
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const { status, body } = await chatMemoryWriteHandler(req.body);
    res.status(status).json(body);
    return;
  }
  if (req.method === 'GET') {
    const { client_id } = req.query || {};
    const { status, body } = await chatMemoryReadHandler(client_id);
    res.status(status).json(body);
    return;
  }
  if (req.method === 'DELETE') {
    const { client_id } = req.query || {};
    const { status, body } = await chatMemoryDeleteHandler(client_id);
    res.status(status).json(body);
    return;
  }
  res.status(405).json({ error: 'method_not_allowed' });
};
