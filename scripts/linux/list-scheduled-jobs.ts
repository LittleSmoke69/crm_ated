import { SCHEDULED_JOBS } from './scheduled-jobs';

for (const job of SCHEDULED_JOBS) {
  console.log(`${job.cron}  ${job.name}`);
}
