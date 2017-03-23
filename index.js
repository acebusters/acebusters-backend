const AWS = require('aws-sdk');
const Web3 = require('web3');
const doc = require('dynamodb-doc');
AWS.config.update({region: 'eu-west-1'});

const Db = require('./lib/db');
const TableContract = require('./lib/tableContract');
const TableManager = require('./lib/index');
var ReceiptCache = require('poker-helper').ReceiptCache;

var web3, dynamo = new doc.DynamoDB();

var rc = new ReceiptCache();

exports.handler = function(event, context, callback) {

  if (event.context['http-method'] != 'GET') {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
  }

  if (typeof web3 === 'undefined') {
    web3 = new Web3(new Web3.providers.HttpProvider(event['stage-variables'].providerUrl));
  }
  
  var handleRequest,
    manager = new TableManager(new Db(dynamo), new TableContract(web3), rc, process.env.ORACLE_PRIV),
    path = event.context['resource-path'];
  if (path.indexOf('pay') > -1) {
    handleRequest = manager.pay(event.params.path.tableAddr, event.params.header.Authorization);
  } else if (path.indexOf('info') > -1) {
    handleRequest = manager.info(event.params.path.tableAddr, event['stage-variables'].tableContracts);
  } else if (path.indexOf('netting') > -1) {
    handleRequest = manager.netting(event.params.path.tableAddr, event.params.path.handId, event.nettingSig);
  } else if (path.indexOf('hand') > -1) {
    handleRequest = manager.hand(event.params.path.tableAddr, event.params.path.handId);
  } else if (path.indexOf('config') > -1) {
    handleRequest = manager.getConfig(event['stage-variables']);
  } else if (path.indexOf('show') > -1) {
    handleRequest = manager.show(event.params.path.tableAddr, event.params.header.Authorization, event.cards);
  } else if (path.indexOf('leave') > -1) {
    handleRequest = manager.leave(event.params.path.tableAddr, event.params.header.Authorization);
  } else if (path.indexOf('timeout') > -1) {
    handleRequest = manager.timeout(event.params.path.tableAddr);
  } else {
    handleRequest = Promise.reject('Error: unexpected path: ' + path);
  }

  handleRequest
  .then(function(data){
    callback(null, data);
  })
  .catch(function(err){
    console.log(err.stack);
    callback(err);
  });
}