# Acebusters backend services

- **common** — common code for services
- **accountless-faucet** — service for funding auto-generated accounts
- **contract-scanner** — service for sending table contract events to aws sns
- **event-worker** — service for handling sns events
- **interval-scanner** — kicks players, sends netting events
- **oracle-cashgame** — game logic for cashgame tables
- **reserve-service** — service for reserving seats while joining
- **stream-scanner** — checks dynamo stream and takes actions

## Development flow

1. `npm install`
2. `cd put_service_name_here`
3. `npm install`
4. Make your changes
5. `npm test`
6. Commit

## Common code for development env

`common` installs like dependency so if you will just change the code in common folder it won't change for the service until `npm install`

For changing common code you can use `npm link`:

1. `cd common && npm link && cd ..`
2. `cd put_service_name_here`
3. `npm link ab-backend-common`

These commands will create symlink for common folder in `{put service name here}/node_modules`


## Build and deploy

In root folder:

`PACKAGE=put_service_name_here npm run package`

This command will generate `put_service_name_here-lambda.zip` file in root folder. You need to upload this file to AWS Lambda.
