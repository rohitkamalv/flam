import Database from 'better-sqlite3';
import { get as getConfig } from './config.js';

let db;

function initializeDatabase() {
    if (!db) {
        db = new Database('job-queue.db')

        const createJobsTableSQL = `
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE,
                command TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                last_attempt_at INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                started_at INTEGER,
                completed_at INTEGER,
                error_message TEXT,
                locked_until INTEGER
            );
        `;
        db.exec(createJobsTableSQL);
        // console.log('Database initialized and jobs table ensured.');
    }
    return db;
}

function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
}

function enqueueJob(command, user_id = null) {
     const db = getDatabase();
     const stmt = db.prepare(`
         INSERT INTO jobs (command, status, created_at, updated_at, user_id) VALUES (?, 'pending', strftime('%s', 'now'), strftime('%s', 'now'), ?)
        `);
     const info = stmt.run(command, user_id);
     return info.lastInsertRowid;
}

function getJobForWorker(lockDurationSeconds = 300) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp
    const config = getConfig();
    const backoffBase = config.backoff_base || 2; 

    const job = db.transaction(() => {
        const selectStmt = db.prepare(`
            SELECT * FROM jobs
            WHERE
                (status = 'pending' OR (status = 'failed' AND (last_attempt_at IS NULL OR last_attempt_at + POWER(?, attempts) <= ?)))
                AND (locked_until IS NULL OR locked_until <= ?)
            ORDER BY created_at ASC
            LIMIT 1
        `);
        const availableJob = selectStmt.get(backoffBase, now, now);

        if (availableJob) {
            const lockUntil = now + lockDurationSeconds;
            const updateStmt = db.prepare(`
                UPDATE jobs
                SET
                    status = 'processing',
                    started_at = ?,
                    locked_until = ?,
                    updated_at = ?
                WHERE id = ?
            `);
            updateStmt.run(now, lockUntil, now, availableJob.id);
            return { ...availableJob, status: 'processing', started_at: now, locked_until: lockUntil, updated_at: now };
        }
        return null;
    })();
    return job;
}

function updateJobStatus(job_id, newStatus, options = {}) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const { errorMessage, attempts, lastAttemptAt } = options;

    let setClauses = ['status = ?', 'updated_at = ?', 'locked_until = NULL'];
    let params = [newStatus, now];

    if (newStatus === 'completed') {
        setClauses.push('completed_at = ?');
        params.push(now);
    }
    if (newStatus === 'failed' || newStatus === 'dead') {
        if (errorMessage !== undefined) {
            setClauses.push('error_message = ?');
            params.push(errorMessage);
        }
        if (attempts !== undefined) {
            setClauses.push('attempts = ?');
            params.push(attempts);
        }
        if (lastAttemptAt !== undefined) {
            setClauses.push('last_attempt_at = ?');
            params.push(lastAttemptAt);
        }
    }

    params.push(job_id);

    const updateStmt = db.prepare(`
        UPDATE jobs
        SET ${setClauses.join(', ')}
        WHERE id = ?
    `);
    updateStmt.run(...params);
}

function incrementJobAttempts(job_id, error_message = null) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);

    let setClauses = ['attempts = attempts + 1', 'last_attempt_at = ?', 'updated_at = ?', 'locked_until = NULL'];
    let params = [now, now];

    if (error_message !== null) {
        setClauses.push('error_message = ?');
        params.push(error_message);
    }

    params.push(job_id);

    const updateStmt = db.prepare(`
        UPDATE jobs
        SET
            ${setClauses.join(', ')}
        WHERE id = ?
    `);
    updateStmt.run(...params);
}

function releaseJobLock(job_id) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    
    const releasestmt = db.prepare(`
        UPDATE jobs
        SET locked_until = NULL, updated_at = ?
        WHERE id = ?
    `);
    
    releasestmt.run(now, job_id);
}

function getJobsByStatus(status = null) {
    const db = getDatabase();

    if (status) {
        const stmt = db.prepare(`SELECT * FROM jobs WHERE status = ?`);
        return stmt.all(status);
    } else {
        const stmt = db.prepare(`SELECT * FROM jobs`);
        return stmt.all();
    }
}

function getDlqJobs() {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM jobs WHERE status = 'dead'`);
    return stmt.all();
}

function retryDlqJob(job_id) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);

    const updateStmt = db.prepare(`
        UPDATE jobs
        SET status = 'pending',
            attempts = 0,
            last_attempt_at = NULL,
            error_message = NULL,
            locked_until = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'dead'
    `);
    updateStmt.run(now, job_id);
}

function getJobCounts() {
    const db = getDatabase();
    const stmt = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM jobs
        GROUP BY status
    `);
    const rows = stmt.all();
    const counts = {
        pending: 0,
        processing: 0,
        failed: 0,
        dead: 0,
        completed: 0
    };
    rows.forEach(row => {
        if (counts.hasOwnProperty(row.status)) {
            counts[row.status] = row.count;
        }
    });
    return counts;
}

export {
    initializeDatabase,
    getDatabase,
    enqueueJob,
    getJobForWorker, 
    updateJobStatus,
    incrementJobAttempts,
    releaseJobLock,
    getJobsByStatus,
    getDlqJobs,
    retryDlqJob,
    getJobCounts
};