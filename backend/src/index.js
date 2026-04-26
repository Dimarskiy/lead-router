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
  const slackRouter = require('./routes/slack');
  const timeoutWorker = require('./workers/timeout');
  const morningReport = require('./workers/morningReport');

  app.use('/webhook', webhookRouter);
  app.use('/api', apiRouter);
  app.use('/slack', slackRouter);

  app.listen(PORT, () => {
    console.log(`\n🚀 Lead Router backend running on port ${PORT}`);
    console.log(`   Webhook URL:    http://localhost:${PORT}/webhook/pipedrive`);
    console.log(`   Slack actions:  http://localhost:${PORT}/slack/interactive`);
    console.log(`   Slash commands: http://localhost:${PORT}/slack/command`);
    console.log(`   Admin UI:       http://localhost:5173\n`);
    timeoutWorker.start();
    morningReport.start();
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
