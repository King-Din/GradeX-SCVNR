import 'dotenv/config';
import express from 'express';

import submissionRoutes from './routes/submission.routes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.use('/api', submissionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
