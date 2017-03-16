const AWS = require('aws-sdk');
const StreamWorker = require('./lib/index');
var Pusher = require('pusher');
var ReceiptCache = require('poker-helper').ReceiptCache;

var pusher = new Pusher({
  appId: '314687',
  key: 'd4832b88a2a81f296f53',
  secret: 'f8e280d370f8870fcfaa',
  cluster: 'eu',
  encrypted: true
});

var rc = new ReceiptCache();

exports.handler = function(event, context, callback) {

  if (event.Records && event.Records instanceof Array) {

    var requests = [];
    var worker = new StreamWorker(new AWS.SNS(), process.env.TOPIC_ARN, pusher, rc);
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i]));
    }
    Promise.all(requests).then(function(data) {
      console.log(JSON.stringify(data));
      callback(null, data);
    }).catch(function(err) {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(null, err);
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
    console.log('no action taken.');
  }
}