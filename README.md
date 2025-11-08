# queuectl

`queuectl` is a CLI-based background job queue system built with Node.js and SQLite. It allows you to enqueue shell commands as jobs, have them executed by multiple workers, and manage their lifecycle. It features automatic retries with exponential backoff for failed jobs and a Dead Letter Queue (DLQ) for jobs that have terminally failed.

## Features

- **Persistent Job Queue:** Jobs are stored in an SQLite database, ensuring durability.
- **Concurrent Workers:** Run multiple worker processes to execute jobs in parallel.
- **Command Execution:** Execute any shell command as a job.
- **Automatic Retries:** Failed jobs are automatically retried with an exponential backoff delay.
- **Configurable:** Control settings like max retries and backoff strategy.
- **Dead Letter Queue (DLQ):** Terminally failed jobs are moved to a DLQ for manual inspection and retry.
- **Graceful Shutdown:** Workers can be gracefully shut down, allowing them to finish their current job.
- **Scheduled Jobs

## Installation

1.  **Clone the repository:**
    ```bash
    git clone git@github.com:rohitkamalv/flam.git
    cd queuectl
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Working CLI demo : https://drive.google.com/file/d/1s-BemWIHV-mDe0FZvMSesxLWGZku7J7K/view?usp=share_link


## Usage

The main command is `queuectl`, which you can run using `node src/index.js`.

### `enqueue`

Enqueue a new job.

**Usage:**
```bash
node src/index.js enqueue '<json-payload>'
```

**Payload:**
- `command` (required): The shell command to execute.
- `id` (optional): A unique user-defined ID for the job.

**Example:**
```bash
node src/index.js enqueue '{"id": "job1", "command": "echo Hello World"}'
node src/index.js enqueue '{"command": "ls -la"}'
```

### `list`

List all jobs or filter by status.

**Usage:**
```bash
node src/index.js list [status]
```

**Statuses:** `pending`, `processing`, `completed`, `failed`, `dead`

**Example:**
```bash
# List all jobs
node src/index.js list

# List only pending jobs
node src/index.js list pending
```

### `status`

Show a summary of the job queue and worker status and pids.

**Usage:**
```bash
node src/index.js status
```

### `worker`

Manage worker processes.

**Usage:**
```bash
# Start one worker
node src/index.js worker start

# Start 3 workers
node src/index.js worker start --count 3

# Stop all workers gracefully
node src/index.js worker stop

# Stop a specific worker
node src/index.js worker stop <pid>
```

### `dlq`

Manage the Dead Letter Queue.

**Usage:**
```bash
# List all jobs in the DLQ
node src/index.js dlq list

# Retry a job from the DLQ
node src/index.js dlq retry <job-id>
```

### `config`

Manage configuration.

**Usage:**
```bash
# View current configuration
node src/index.js config

# View a specific key
node src/index.js config max_retries

# Set a configuration value
node src/index.js config set max_retries 5
node src/index.js config set backoff_base 3
```

## Configuration

The configuration is stored in `config.json`. You can edit this file directly or use the `config set` command.

- `max-retries`: The maximum number of times a job will be retried before being moved to the DLQ.
- `backoff-base`: The base for the exponential backoff calculation (`delay = base ^ attempts`).

## Architecture

- **`src/index.js`**: The main entry point for the `yargs`-based CLI.
- **`src/database.js`**: Manages all interactions with the SQLite database (`job-queue.db`). It uses `better-sqlite3`.
- **`src/worker.js`**: The core worker logic. It fetches a job, executes the command, and updates the job status.
- **`src/workerManager.js`**: Handles starting and stopping worker processes using Node's `child_process`. It keeps track of worker PIDs in `worker-pids.json`.
- **`src/config.js`**: Manages reading and writing configuration from `config.json`.
- **`job-queue.db`**: The SQLite database file.
- **`config.json`**: The configuration file.
- **`worker-pids.json`**: Stores the PIDs of running worker processes.

## Assumptions & Trade-offs

This project was designed with simplicity and ease of use for a single-machine environment. This leads to several trade-offs:

*   **Database**: `SQLite` is used for its simplicity and zero-configuration setup. This is ideal for a self-contained CLI tool but would not be suitable for a high-throughput, distributed system where a more robust client-server database (like PostgreSQL or MySQL) would be required.
*   **Worker Management**: Worker processes are managed using Node.js's `child_process` module and a simple PID file (`worker-pids.json`). This is straightforward but less resilient than a dedicated process manager like `PM2`, which provides automatic restarts, logging, and monitoring.
*   **Job Locking**: The system uses a database transaction to lock a job when a worker picks it up. This is a simple and effective mechanism for the current scale but could become a performance bottleneck under very high worker contention.
*   **Scalability**: The entire system is designed to run on a single machine. It cannot scale horizontally across multiple machines without significant architectural changes.
*   **Security**: The CLI assumes that the user has the necessary permissions to execute the shell commands. There are no additional security layers to restrict what commands can be enqueued or executed.

## Testing Instructions

The simplest way to verify the functionality of `queuectl` is to run the provided verification script. This script performs an end-to-end test that demonstrates job creation, processing, failure handling, and cleanup.

To run the script:
```bash
bash verify.sh
```