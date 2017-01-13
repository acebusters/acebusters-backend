const AWS = require('aws-sdk');
const doc = require('dynamodb-doc');
AWS.config.update({region: 'eu-west-1'});

const Provider = require('./lib/provider');
const Db = require('./lib/db');
const Contract = require('./lib/blockchain');
const TableManager = require('./lib/index');
var ReceiptCache = require('poker-helper').ReceiptCache;

var provider, dynamo = new doc.DynamoDB();

var rc = new ReceiptCache();

exports.handler = function(event, context, callback) {

  console.log('Request received:\n', JSON.stringify(event));
  console.log('Context received:\n', JSON.stringify(context));

  if (!provider) {
    provider = new Provider(event['stage-variables'].providerUrl);
  }
  
  var handleRequest,
    manager = new TableManager(new Db(dynamo), new Contract(provider), rc),
    path = event.context['resource-path'];
  if (path.indexOf('pay') > -1) {
    handleRequest = manager.pay(event.params.path.tableAddr, event.params.header.Authorization);
  } else if (path.indexOf('info') > -1) {
    handleRequest = manager.info(event.params.path.tableAddr);
  } else if (path.indexOf('config') > -1) {
    handleRequest = manager.getConfig(event['stage-variables']);
  } else if (path.indexOf('show') > -1) {
    handleRequest = manager.show(event.params.path.tableAddr, event.params.header.Authorization, event.cards);
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