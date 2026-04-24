require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  credentials: false,
}));
app.use(express.json());
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

initDb().then(() => {
  const webhookRouter = require('./routes/webhook');
  const apiRouter = require('./routes/api');
  const timeoutWorker = require('./workers/timeout');

  app.use('/webhook', webhookRouter);
  app.use('/api', apiRouter);

  app.listen(PORT, () => {
    console.log(`\n🚀 Lead Router backend running on port ${PORT}`);
    console.log(`   Webhook URL: http://localhost:${PORT}/webhook/pipedrive`);
    console.log(`   Admin UI:    http://localhost:5173\n`);
    timeoutWorker.start();
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
