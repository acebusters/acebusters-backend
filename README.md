## stream worker

checks dynamo stream and takes actions

## DB Events:

1. leave receipt is received => send tx to table => NettingRequestEvent
2. hand with leaving player is completed => calculate and sign netting for table
3. everyone signed netting receipt => send tx to table => NettingEvent

## Contract Events:

1. Netting Event => payout leaving player & pool
2. Error event => write logs
3. 

## Timer events:

1. Nuts mining
2. powerdown 
3. submit receipts => call net => NettingEvent


