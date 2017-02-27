var AWS = require('aws-sdk');
const StreamWorker = require('./lib/index');
const Provider = require('./lib/provider');
const Table = require('./lib/tableContract');

var provider;

exports.handler = function(event, context, callback) {

  if (event.Records && event.Records instanceof Array) {
    
    if (!provider) {
      provider = new Provider(process.env.providerUrl,  process.env.recKey);
    }

    var requests = [];
    var worker = new StreamWorker(new Table(provider));
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i]));
    }
    Promise.all(requests).then(function(data) {
      callback(null, data);
    }).catch(function(err) {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(err);
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
  }
}