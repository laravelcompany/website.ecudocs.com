import express from 'express';
import cors from 'cors';
import { rewriteSingle, rewriteBatch } from './rewrite.js';
import { writeMdx, writeBatch } from './astro-writer.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const jobs = new Map();

app.post('/rewrite', async (req, res) => {
  try {
    const { product, options } = req.body;
    
    if (!product) {
      return res.status(400).json({ error: 'product is required' });
    }
    
    const result = await rewriteSingle(product, options);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/batch', async (req, res) => {
  try {
    const { products, options, outputDir } = req.body;
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'products array is required' });
    }
    
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const job = {
      id: jobId,
      status: 'running',
      progress: { current: 0, total: products.length, percentage: 0 },
      results: [],
      createdAt: new Date().toISOString(),
    };
    
    jobs.set(jobId, job);
    
    res.json({ success: true, jobId, status: 'started' });
    
    (async () => {
      try {
        const results = await rewriteBatch(products, options, (progress) => {
          job.progress = progress;
          jobs.set(jobId, job);
        });
        
        job.results = results;
        job.status = 'completed';
        
        if (outputDir) {
          const written = await writeBatch(results, outputDir);
          job.written = written;
        }
        
        jobs.set(jobId, job);
      } catch (err) {
        job.status = 'failed';
        job.error = err.message;
        jobs.set(jobId, job);
      }
    })();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/batch/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const response = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
  };
  
  if (job.status === 'completed') {
    response.results = job.results;
    response.written = job.written;
  }
  
  if (job.status === 'failed') {
    response.error = job.error;
  }
  
  res.json(response);
});

app.get('/batch', (req, res) => {
  const allJobs = Array.from(jobs.entries()).map(([id, job]) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
  }));
  
  res.json({ jobs: allJobs });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Rewrite API server running on port ${port}`);
    console.log(`  POST /rewrite - Single product rewrite`);
    console.log(`  POST /batch   - Batch rewrite (async)`);
    console.log(`  GET  /batch/:jobId - Check job status`);
  });
}

export default app;
export { startServer };

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
