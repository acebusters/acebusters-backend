import Web3 from 'web3';
import doc from 'dynamodb-doc';
import { ReceiptCache } from 'poker-helper';
import Raven from 'raven';
import Pusher from 'pusher';

import Db from './src/db';
import TableContract from './src/tableContract';
import TableManager from './src/index';
import Logger from './src/logger';

let web3;
let pusher;
const dynamo = new doc.DynamoDB();
const rc = new ReceiptCache();

const handleError = function handleError(err, logger, callback) {
  if (err.errName) {
    // these are known errors: 4xx
    logger.message(err, {
      level: 'warning',
    }).then(callback);
  } else {
    logger.exception(err).then(callback);
  }
};

exports.handler = function handler(event, context, callback) {
  const providerUrl = process.env.PROVIDER_URL;
  const sentryUrl = process.env.SENTRY_URL;
  const tableName = process.env.TABLE_NAME;

  const getTimeout = (handState) => {
    if (handState === 'waiting' || handState === 'dealing') {
      return 10;
    }

    return 40;
  };

  Raven.config(sentryUrl).install();
  const logger = new Logger(Raven, context.functionName, 'oracle-cashgame');

  if (typeof pusher === 'undefined') {
    pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: 'eu',
      encrypted: true,
    });
  }

  if (typeof web3 === 'undefined') {
    web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
  }

  let handleRequest;
  const manager = new TableManager(
    new Db(dynamo, tableName),
    new TableContract(web3),
    rc,
    getTimeout,
    pusher,
    providerUrl,
    logger,
  );
  const path = event.context['resource-path'];
  const tableAddr = event.params.path.tableAddr;
  const handId = event.params.path.handId;
  try {
    if (path.indexOf('pay') > -1) {
      handleRequest = manager.pay(tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('info') > -1) {
      handleRequest = manager.info(tableAddr);
    } else if (path.indexOf('netting') > -1) {
      handleRequest = manager.netting(tableAddr, handId, event.nettingSig);
    } else if (path.indexOf('hand') > -1) {
      handleRequest = manager.getHand(tableAddr, handId);
    } else if (path.indexOf('message') > -1) {
      handleRequest = manager.handleMessage(event.msgReceipt);
    } else if (path.indexOf('config') > -1) {
      handleRequest = manager.getConfig();
    } else if (path.indexOf('show') > -1) {
      handleRequest = manager.show(tableAddr, event.params.header.Authorization, event.cards);
    } else if (path.indexOf('leave') > -1) {
      handleRequest = manager.leave(tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('timeout') > -1) {
      handleRequest = manager.timeout(tableAddr);
    } else if (path.indexOf('lineup') > -1) {
      handleRequest = manager.lineup(tableAddr);
    } else {
      handleRequest = Promise.reject(`Error: unexpected path: ${path}`);
    }
  } catch (err) {
    return handleError(err, logger, callback);
  }

  return handleRequest
    .then(data => callback(null, data))
    .catch(err => handleError(err, logger, callback));
};
