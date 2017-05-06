import Web3 from 'web3';
import doc from 'dynamodb-doc';
import { ReceiptCache } from 'poker-helper';
import Raven from 'raven';
import Pusher from 'pusher';

import Db from './src/db';
import TableContract from './src/tableContract';
import TableManager from './src/index';

const pusher = new Pusher({
  appId: '314687',
  key: 'd4832b88a2a81f296f53',
  secret: 'f8e280d370f8870fcfaa',
  cluster: 'eu',
  encrypted: true,
});

let web3;
const dynamo = new doc.DynamoDB();
const rc = new ReceiptCache();

const handleError = function handleError(err, callback) {
  if (err.errName) {
    // these are known errors: 4xx
    Raven.captureMessage(err, {
      server_name: 'oracle-cashgame',
      level: 'warning',
    }, (sendErr) => {
      if (sendErr) {
        console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
        callback(`Error: ${err.message}`);
        return;
      }
      callback(err.message);
    });
  } else {
    Raven.captureException(err, { server_name: 'oracle-cashgame' }, (sendErr) => {
      if (sendErr) {
        console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
        callback(`Error: ${sendErr} - ${err.message}`);
        return;
      }
      callback(`Error: ${err.message}`);
    });
  }
};

exports.handler = function handler(event, context, callback) {
  Raven.config(process.env.SENTRY_URL).install();

  if (typeof web3 === 'undefined') {
    web3 = new Web3(new Web3.providers.HttpProvider(event['stage-variables'].providerUrl));
  }

  let handleRequest;
  const manager = new TableManager(new Db(dynamo),
    new TableContract(web3), rc, process.env.ORACLE_PRIV, pusher);
  const path = event.context['resource-path'];
  const tableAddr = event.params.path.tableAddr;
  const handId = event.params.path.handId;
  try {
    if (path.indexOf('pay') > -1) {
      handleRequest = manager.pay(tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('info') > -1) {
      handleRequest = manager.info(tableAddr, event['stage-variables'].tableContracts);
    } else if (path.indexOf('netting') > -1) {
      handleRequest = manager.netting(tableAddr, handId, event.nettingSig);
    } else if (path.indexOf('hand') > -1) {
      handleRequest = manager.getHand(tableAddr, handId);
    } else if (path.indexOf('message') > -1) {
      handleRequest = manager.handleMessage(event.msgReceipt);
    } else if (path.indexOf('config') > -1) {
      handleRequest = manager.getConfig(event['stage-variables']);
    } else if (path.indexOf('show') > -1) {
      handleRequest = manager.show(tableAddr, event.params.header.Authorization, event.cards);
    } else if (path.indexOf('leave') > -1) {
      handleRequest = manager.leave(tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('timeout') > -1) {
      handleRequest = manager.timeout(tableAddr);
    } else {
      handleRequest = Promise.reject(`Error: unexpected path: ${path}`);
    }
  } catch (err) {
    handleError(err, callback);
    return;
  }

  handleRequest
  .then((data) => {
    callback(null, data);
  })
  .catch((err) => {
    handleError(err, callback);
  });
};
