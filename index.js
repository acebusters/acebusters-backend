const AWS = require('aws-sdk');
const StreamWorker = require('./lib/index');

exports.handler = function(event, context, callback) {

  if (event.Records && event.Records instanceof Array) {

    var requests = [];
    var worker = new StreamWorker(new AWS.SNS(), process.env.TOPIC_ARN);
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i]));
    }
    Promise.all(requests).then(function(data) {
      console.log(JSON.stringify(data));
      callback(null, data);
    }).catch(function(err) {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(err);
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
    console.log('no action taken.');
  }
}