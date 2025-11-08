#!/bin/bash

# A script to verify and demonstrate the core functionality of queuectl.
# This script ensures a clean state by removing old database and pid files before running.

# --- Utility Functions ---
function print_header() {
  echo ""
  echo "================================================================================"
  echo ">= $1"
  echo "================================================================================"
}

# --- Setup: Ensure a clean environment ---
print_header "Setting up a clean environment"
rm -f job-queue.db worker-pids.json
echo "Removed old database and worker pid files."

# Initialize a fresh database by running a command that triggers it
./src/index.js status

print_header "Initial State: Listing jobs in the new empty queue"
./src/index.js list

print_header "Configuration: Setting max_retries to 2 and base to 2 for faster testing"
./src/index.js config set max_retries 2
./src/index.js config set backoff_base 2

print_header "Configuration: Verifying the new settings"
./src/index.js config

print_header "Enqueueing a job that will succeed"
# Note the payload is a valid JSON string as required by the README
./src/index.js enqueue '{"command": "echo \"Hello from a successful job!\""}'

print_header "Enqueueing a job that will fail and be sent to DLQ"
# This command will fail, triggering the retry mechanism
./src/index.js enqueue '{"command": "this-command-does-not-exist"}'

print_header "Enqueueing a job with a custom user-defined ID"
./src/index.js enqueue '{"id": "custom-job-123", "command": "date"}'

print_header "Listing all jobs (should show 3 pending jobs)"
./src/index.js list

print_header "Worker Management: Starting one worker process in background"
./src/index.js worker start --count 1 > worker.log 2>&1 &
WORKER_PID=$!

sleep 2 #To let worker start up and log

print_header "Current Status: Verifying that 1 worker is running"
./src/index.js status

print_header "Waiting for the worker to process jobs (15 seconds)..."
# This should be enough time for the successful jobs to complete and the failing job to fail 3 times (1 initial + 2 retries)
sleep 15

print_header "Listing jobs after processing"
# We expect to see two 'completed' jobs and one 'dead' job.
./src/index.js list

print_header "DLQ: Listing jobs in the Dead Letter Queue (should show 1 job)"
./src/index.js dlq list

print_header "DLQ: Retrying the failed job from the DLQ"
# For this script, we assume the failed job has internal ID 2, which it should on a clean run.
./src/index.js dlq retry 2

print_header "Listing jobs after retry request (should be 'pending' again)"
./src/index.js list pending

print_header "Waiting for the worker to re-process the retried job (15 seconds)..."
# It will fail again and go back to the DLQ
sleep 15

print_header "DLQ: Verifying the job is back in the DLQ"
./src/index.js dlq list

print_header "Worker Management: Stopping all running workers"
./src/index.js worker stop

print_header "Final Status Check"
./src/index.js status

print_header "Verification complete!"