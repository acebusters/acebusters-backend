import Web3 from 'web3';
import doc from 'dynamodb-doc';
import { ReceiptCache } from 'poker-helper';
import Raven from 'raven';

import Db from './src/db';
import TableContract from './src/tableContract';
import TableManager from './src/index';


let web3;
const dynamo = new doc.DynamoDB();
const rc = new ReceiptCache();

const handleError = function handleError(err, callback) {
  Raven.captureException(err, (sendErr) => {
    if (sendErr) {
      console.log('Failed to send captured exception to Sentry');
      console.log(JSON.stringify(sendErr));
      callback(sendErr);
      return;
    }
    if (err.name) {
      // these are known errors: 4xx
      callback(err.message);
    } else {
      // this shall map to http 500
      callback(`Error: ${err.message}`);
    }
  });
}

exports.handler = function handler(event, context, callback) {
  Raven.config(process.env.SENTRY_URL, {
    captureUnhandledRejections: true,
  }).install(() => {
    callback(null, 'This is thy sheath; there rust, and let me die.');
  });

  if (typeof web3 === 'undefined') {
    web3 = new Web3(new Web3.providers.HttpProvider(event['stage-variables'].providerUrl));
  }

  let handleRequest;
  const manager = new TableManager(new Db(dynamo), new TableContract(web3), rc, process.env.ORACLE_PRIV);
  const path = event.context['resource-path'];
  try {
    if (path.indexOf('pay') > -1) {
      handleRequest = manager.pay(event.params.path.tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('info') > -1) {
      handleRequest = manager.info(event.params.path.tableAddr, event['stage-variables'].tableContracts);
    } else if (path.indexOf('netting') > -1) {
      handleRequest = manager.netting(event.params.path.tableAddr, event.params.path.handId, event.nettingSig);
    } else if (path.indexOf('hand') > -1) {
      handleRequest = manager.getHand(event.params.path.tableAddr, event.params.path.handId);
    } else if (path.indexOf('config') > -1) {
      handleRequest = manager.getConfig(event['stage-variables']);
    } else if (path.indexOf('show') > -1) {
      handleRequest = manager.show(event.params.path.tableAddr, event.params.header.Authorization, event.cards);
    } else if (path.indexOf('leave') > -1) {
      handleRequest = manager.leave(event.params.path.tableAddr, event.params.header.Authorization);
    } else if (path.indexOf('timeout') > -1) {
      handleRequest = manager.timeout(event.params.path.tableAddr);
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
