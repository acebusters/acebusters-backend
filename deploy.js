const changedFolders = require('github-changed-folders');
const { spawn } = require('child_process');

// set by Shippable
const commit = process.env.COMMIT;

const sandboxLambdas = {
  'accountless-faucet': 'ab-faucet-service',
  'account-service': 'sb-account-service',
  'contract-scanner': 'ab-contract-scanner',
  'event-worker': 'sb-event-worker',
  'interval-scanner': 'ab-interval-scanner',
  'oracle-cashgame': 'poker',
  'reserve-service': 'ab-seats-reservation',
  'stream-scanner': 'sb-stream-scanner',
};

changedFolders('parsec-labs/acebusters-backend', commit).then((repos) => {
  // if 'common' changed rebuild and deploy all the services
  if (repos.includes('common')) {
    repos = Object.keys(sandboxLambdas);
  }
  repos.forEach((repo) => {
    console.log(`Packaging ${repo}..`);  // eslint-disable-line no-console
    const child = spawn('npm', ['run', 'deploy'], {
      env: Object.assign(process.env, {
        PACKAGE: repo,
        LAMBDA_NAME: sandboxLambdas[repo],
      }),
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    process.on('error', () => process.exit(1));
    process.on('exit', () => { console.log('Done.'); });  // eslint-disable-line no-console
  });
});
