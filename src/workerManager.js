import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { fork } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKER_PIDS_FILE_PATH = path.join(__dirname, '..', 'worker-pids.json');

const WORKER_SCRIPT_PATH = path.join(__dirname, 'worker.js');

function readWorkerPids() {
    try {
        if (fs.existsSync(WORKER_PIDS_FILE_PATH)) {
            const content = fs.readFileSync(WORKER_PIDS_FILE_PATH, 'utf8');
            if (content.trim() === '') {
                return [];
            }
            const pids = JSON.parse(content);
            return pids.filter(pid => {
                try {
                    process.kill(pid, 0);
                    return true;
                } catch (error) {
                    return false;
                }
            });
        }
    } catch (error) {
        console.error('Error reading or parsing worker PIDs file. Starting fresh:', error.message);
    }
    return [];
}

function writeWorkerPids(pids) {
    try {
        const jsonString = JSON.stringify(pids, null, 2);
        fs.writeFileSync(WORKER_PIDS_FILE_PATH, jsonString, 'utf8');
    } catch (error) {
        console.error('Error writing worker PIDs file:', error.message);
        throw error;
    }
}

function startWorker(count = 1) {
    let activePids = readWorkerPids();
    const startedPids = [];

    for (let i = 0; i < count; i++) {
        try {
            const worker = fork(WORKER_SCRIPT_PATH, [], {
                detached: true,
                stdio: 'inherit'
            });

            worker.unref();

            activePids.push(worker.pid);
            startedPids.push(worker.pid);
            console.log(`Worker started with PID: ${worker.pid}`);

        } catch (error) {
            console.error(`Error starting worker ${i + 1}:`, error.message);
        }
    }

    writeWorkerPids(activePids);
    return startedPids;
}

function stopWorker(pid = null) {
    let activePids = readWorkerPids();
    const stoppedPids = [];

    if (pid !== null) {
        if (activePids.includes(pid)) {
            try {
                process.kill(pid, 'SIGTERM');
                stoppedPids.push(pid);
                console.log(`Sent SIGTERM to worker PID: ${pid}`);
            }
            catch (error) {
                console.error(`Error stopping worker PID ${pid}:`, error.message);
            }
            activePids = activePids.filter(activePid => activePid !== pid);
            writeWorkerPids(activePids);
            return stoppedPids;
        } else {
            console.warn(`No active worker found with PID: ${pid}`);
        }
    
    } else {
        for (const activePid of activePids) {
            try {
                process.kill(activePid, 'SIGTERM');
                stoppedPids.push(activePid);
                console.log(`Sent SIGTERM to worker PID: ${activePid}`);
            } catch (error) {
                if (error.code === 'ESRCH') {
                    console.warn(`Worker PID ${activePid} does not exist. It may have already exited.`);
                } else {
                    console.error(`Error stopping worker PID ${activePid}:`, error.message);
                }
            }
        }
    }

    activePids = activePids.filter(activePid => !stoppedPids.includes(activePid));
    writeWorkerPids(activePids);
    return stoppedPids;
}


            

export {
    startWorker,
    readWorkerPids,
    stopWorker,
};