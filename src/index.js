#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'; 
import { initializeDatabase, enqueueJob, getJobsByStatus, getDlqJobs, retryDlqJob, getJobCounts } from "./database.js";
import { get as getConfig, set as setConfig } from "./config.js"; 
import { startWorker, stopWorker, readWorkerPids } from './workerManager.js';
initializeDatabase();

const argv = yargs(hideBin(process.argv))
  .scriptName('queuectl')
  .usage('$0 <cmd> [args]')

  .command(
    'enqueue <jobPayload>',
    'Enqueue a new job with the given payload',
    (yargs) => {
      yargs.positional('jobPayload', {
        type: 'string',
        describe: 'JSON string containing job details (e.g., {"id":"job-id","command":"echo hello"})',
      });
    },
    (argv) => {
        try {
            const parsedPayload = JSON.parse(argv.jobPayload);
            const {id, command} = parsedPayload;

            if (!command) {
                console.error('Error: Job payload must include "command" field.');
                process.exit(1);
            }

            const newJobId = enqueueJob(command, id);
            console.log(`Enqueued job with id: ${id} and internal row id: ${newJobId}`);
            
        }
        catch (e) {
            console.error('Error: Invalid JSON payload.', e.message);
            process.exit(1);
        }
    }
  )

  .command(
    'list [status]',
    'List jobs, optionally filtered by status',
    (yargs) => {
        yargs.positional('status', {
        describe: 'Filter jobs by status (e.g., pending, completed, failed, dead)',
        type: 'string'
     });
    },
    async (argv) => {
        try {
            const statusFilter = argv.status;
            const jobs = getJobsByStatus(statusFilter);

            if (jobs.length === 0) {
                console.log(`No jobs found${statusFilter ? ` with status "${statusFilter}"` : ''}.`);
                return;
            }

            console.log(`\n--- Jobs ${statusFilter ? `(Status: ${statusFilter})` : '(All Jobs)'} ---`);
            jobs.forEach(job => {
                // Helper function to format Unix timestamps
                const formatTimestamp = (timestamp) => {
                    return timestamp ? new Date(timestamp * 1000).toLocaleString() : 'N/A';
                };

                console.log(`
  Internal ID: ${job.id}
  User ID: ${job.user_id || 'N/A'}
  Command: ${job.command}
  Status: ${job.status}
  Attempts: ${job.attempts}
  CreatedAt: ${formatTimestamp(job.created_at)}
  UpdatedAt: ${formatTimestamp(job.updated_at)}
  StartedAt: ${formatTimestamp(job.started_at)}
  CompletedAt: ${formatTimestamp(job.completed_at)}
  ${job.error_message ? `Error: ${job.error_message}` : ''}
  ${job.locked_until ? `Locked Until: ${formatTimestamp(job.locked_until)}` : ''}
                `.trim());
            });
            console.log('-----------------------------------\n');

        } catch (e) {
            console.error('Error listing jobs:', e.message);
            process.exit(1);
        }
    }
)

    .command(
    'config [key]',
    'Manage application configuration (e.g., max-retries, backoff-base). Use "config set <key> <value>" to change.',
    (yargs) => {
      yargs.positional('key', {
        describe: 'Optional: Display a specific configuration key. If omitted, shows all config.',
        type: 'string'
      });

      yargs.command(
        'set <key> <value>', 
        'Set a configuration key to a specific value',
        (yargs) => {
          yargs.positional('key', {
            describe: 'The configuration key to set (e.g., max-retries, backoff-base)',
            type: 'string'
          })
          .positional('value', {
            describe: 'The value to set for the configuration key',
            type: 'string' 
          });
        },
        (argv) => {
          try {
            let valueToSet = argv.value;
            if (argv.key === 'max_retries' || argv.key === 'backoff_base') {
                valueToSet = Number(argv.value);
                if (isNaN(valueToSet)) {
                    console.error(`Error: Value for '${argv.key}' must be a number.`);
                    process.exit(1);
                }
            }

            setConfig(argv.key, valueToSet); 
            console.log(`Configuration key '${argv.key}' set to '${valueToSet}' successfully.`);
          } catch (e) {
            console.error('Error setting configuration:', e.message);
            process.exit(1);
          }
        }
      )
      .help(); 
    },
    (argv) => {
      try {
        const config = getConfig();
        if (argv.key) {
          if (config.hasOwnProperty(argv.key)) {
            console.log(`'${argv.key}': ${config[argv.key]}`);
          } else {
            console.error(`Error: Configuration key '${argv.key}' not found.`);
            process.exit(1);
          }
        } else {
          console.log('\n--- Current Configuration ---');
          for (const key in config) {
            console.log(`${key}: ${config[key]}`);
          }
          console.log('-----------------------------\n');
        }
      } catch (e) {
        console.error('Error reading configuration:', e.message);
        process.exit(1);
      }
    }
  )

  .command(
    'worker <command>',
    'Manage worker processes (start, stop)',
    (yargs) => {
        yargs.command(
            'start',
            'Start one or more worker processes',
            (yargs) => {
                yargs.option('count', {
                    describe: 'Number of workers to start',
                    type: 'number',
                    default: 1
                });
            },
            (argv) => {
                try {
                    const startedPids = startWorker(argv.count);
                    console.log(`Started workers with PIDs: ${startedPids.join(', ')}`);
                }
                catch (e) {
                    console.error('Error starting workers:', e.message);
                    process.exit(1);
                }
            },
        )
        .command(
        'stop [pid]',
        'Stop one or all worker processes gracefully',
        (yargs) => {
          yargs.positional('pid', {
            describe: 'Optional: PID of a specific worker to stop. If omitted, all workers will be stopped.',
           type: 'number'
          });
        },
        (argv) => {
          try {
            const stoppedPids = stopWorker(argv.pid);
            console.log(`Stopped workers with PIDs: ${stoppedPids.join(', ')}`);
          } catch (e) {
            console.error('Error stopping worker(s):', e.message);
            process.exit(1);
          }
        }
      )
        .demandCommand(1, 'You need to specify a worker command (start/stop)')
        .help();
    },
  )

  .command(
    'dlq <command>',
    'Manage the Dead Letter Queue (DLQ) for failed jobs',
    (yargs) => {
      yargs.command(
        'list',
        'List all jobs in the Dead Letter Queue',
        () => {},
        async (argv) => {
          try {
            const dlqJobs = getDlqJobs();

            if (dlqJobs.length === 0) {
              console.log('The Dead Letter Queue is empty.');
              return;
            }

            console.log('\n--- Dead Letter Queue Jobs ---');
            dlqJobs.forEach(job => {
                const formatTimestamp = (timestamp) => {
                    return timestamp ? new Date(timestamp * 1000).toLocaleString() : 'N/A';
                };

                console.log(`
  Internal ID: ${job.id}
  User ID: ${job.user_id || 'N/A'}
  Command: ${job.command}
  Status: ${job.status}
  Attempts: ${job.attempts}
  Created: ${formatTimestamp(job.created_at)}
  Updated: ${formatTimestamp(job.updated_at)}
  Started: ${formatTimestamp(job.started_at)}
  Completed: ${formatTimestamp(job.completed_at)}
  Error: ${job.error_message || 'N/A'}
                `.trim());
            });
            console.log('------------------------------\n');

          } catch (e) {
            console.error('Error listing DLQ jobs:', e.message);
            process.exit(1);
          }
        }
      )
      .command(
        'retry <jobId>',
        'Retry a specific job from the Dead Letter Queue',
        (yargs) => {
            yargs.positional('jobId', {
                describe: 'Internal ID of the job to retry from the DLQ',
                type: 'number'
            });
        },
        (argv) => {
            try {
                const jobId = argv.jobId;
                if (!jobId) {
                    console.error('Error: You must provide a valid job ID to retry.');
                    process.exit(1);
                }

                retryDlqJob(jobId);
                console.log(`Job with ID ${jobId} has been retried and moved back to the pending queue.`);
            } catch (e) {
                console.error('Error retrying DLQ job:', e.message);
                process.exit(1);
            }
        }
      )
      .demandCommand(1, 'You need to specify a DLQ command (e.g., list, retry)')
      .help();
    },
    (argv) => {}
  )
  .command(
    'status',
    'Show the current status of the job queue and workers',
    () => {},
    async (argv) => {
        try {
            const jobCounts = getJobCounts();
            const workerPids = readWorkerPids();

            console.log('\n--- Queue Status ---');
            console.log(`Pending:    ${jobCounts.pending}`);
            console.log(`Processing: ${jobCounts.processing}`);
            console.log(`Completed:  ${jobCounts.completed}`);
            console.log(`Failed:     ${jobCounts.failed}`);
            console.log(`DLQ:        ${jobCounts.dead}`);
            console.log('--------------------');
            console.log('\n--- Worker Status ---');
            console.log(`Running Workers: ${workerPids.length}`);
            if (workerPids.length > 0) {
                console.log(`PIDs: ${workerPids.join(', ')}`);
            }
            console.log('---------------------\n');

        } catch (e) {
            console.error('Error fetching status:', e.message);
            process.exit(1);
        }
    }
  )
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .alias('h', 'help')
  .version('1.0.0')
  .alias('v', 'version')
  .parse();