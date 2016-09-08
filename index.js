const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-1'});

const Provider = require('./lib/provider');
const Db = require('./lib/db');
const Contract = require('./lib/blockchain');
const TableManager = require('./lib/index');

var dynamo = new doc.DynamoDB();
var provider = new Provider('http://node.ambisafe.co');

exports.handler = function(event, context, callback) {

  console.log('Request received:\n', JSON.stringify(event));
  console.log('Context received:\n', JSON.stringify(context));
  
  var handleRequest,
    manager = new TableManager(new Db(dynamo), new Contract(provider)),
    path = event.context['resource-path'];
  if (path.indexOf('pay') > -1) {
    handleRequest = manager.pay(event.params.path.tableAddr, event.params.header.Authorization);
  } else if (path.indexOf('info') > -1) {
    handleRequest = manager.info(event.params.path.tableAddr);
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