import { exec } from 'child_process';
import { promisify } from 'util';
import {
    initializeDatabase,
    getJobForWorker,
    incrementJobAttempts,
    updateJobStatus
} from './database.js';
import { get as getConfig } from './config.js';

const execAsync = promisify(exec);
let isShuttingDown = false;
let currentJob = null;

console.log('Worker started with PID:', process.pid);
initializeDatabase();

const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down worker PID: ${process.pid}...`);
    isShuttingDown = true;
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function processJob(job) {
    currentJob = job;
    const now = Math.floor(Date.now() / 1000);
    let errorMessage = null;

    try{
        console.log(`Worker ${process.pid} processing job ${job.id} (User ID: ${job.user_id || 'N/A'}): ${job.command}`);
        const { stdout, stderr } = await execAsync(job.command);

        if (stdout) {
            console.log(`Job ${job.id} output:\n`, stdout);
        }
        if (stderr) {
            console.error(`Job ${job.id} error output:\n`, stderr);
        }

        await updateJobStatus(job.id, 'completed', { 'completedAt': now });
        console.log(`Worker ${process.pid} completed job ${job.id}`);
    } catch (error) {
        errorMessage = error.message;
        console.error(`Worker ${process.pid} failed job ${job.id}:`, errorMessage);
        
        const config = getConfig();
        const maxRetries = config.max_retries;
        const backoffBase = config.backoff_base;

        await incrementJobAttempts(job.id, errorMessage);

        if (job.attempts + 1 >= maxRetries) {
            await updateJobStatus(job.id, 'dead', { errorMessage });
            console.warn(`Job ${job.id} has reached max retries (${maxRetries}) and is moved to DLQ.`);
        } else {
            await updateJobStatus(job.id, 'failed', { errorMessage });
            console.log(`Job ${job.id} will be retried later. Current attempts: ${job.attempts + 1}`);
        }
    } finally {
        currentJob = null;
    }
}

async function workerLoop() {
    const POLLING_INTERVAL_MS = 3000;

    while (true) {
        if (isShuttingDown) {
            if (currentJob === null) {
                console.log(`Worker ${process.pid} loop stopped. Exiting gracefully.`);
                process.exit(0);
            }
            else {
                console.log(`Worker ${process.pid} is finishing job ${currentJob.id} before exiting.`);
                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
                continue;
            }
        }

        let job = null;

        try {
            job = await getJobForWorker();
        } catch (error) {
            console.error(`Worker ${process.pid} database error during job acquisition:`, error.message);
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
            continue;
        }

        if (job) {
            await processJob(job);
        } else {
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
        }
    }
}

workerLoop()