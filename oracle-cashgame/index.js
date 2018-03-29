import Web3 from 'web3';
import AWS from 'aws-sdk';
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
    logger.log(err, {
      level: 'warning',
    }).then(callback);
  } else {
    logger.exception(err).then(callback);
  }
};

exports.handler = function handler(event, context, callback) {
  const sentryUrl = process.env.SENTRY_URL;
  Raven.config(sentryUrl).install();
  const logger = new Logger(Raven, context.functionName, 'oracle-cashgame');

  const providerUrl = process.env.PROVIDER_URL;
  const tableName = process.env.TABLE_NAME;
  const getTimeout = (handState) => {
    if (handState === 'waiting' || handState === 'dealing') {
      return 10;
    }

    return 40;
  };

  const sdbTableName = process.env.OPPONENT_TABLE_NAME;
  const simpledb = new AWS.SimpleDB();

  let handleRequest;
  try {
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

    const manager = new TableManager(
      new Db(dynamo, tableName, simpledb, sdbTableName),
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
    if (path.indexOf('pay') > -1) {
      handleRequest = manager.pay(tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('beat') > -1) {
      handleRequest = manager.beat(tableAddr, event.params.header.Authorization);
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
    } else if (path.indexOf('callOpponent') > -1) {
      handleRequest = manager.callOpponent(
        tableAddr,
        process.env.DISCORD_WEBHOOK_URL,
        process.env.DISCORD_OPPONENT_TEMPLATE,
      );
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
