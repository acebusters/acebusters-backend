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

const Raven = require('raven');
var rc = new ReceiptCache();

exports.handler = function(event, context, callback) {
  Raven.config('https://8c3e021848b247ddaf627c8040f94e07:5f8ebc3e39a84b36b56cd68f401fa830@sentry.io/153017').install(function() {
    callback(null, 'This is thy sheath; there rust, and let me die.');
  });

  if (event.Records && event.Records instanceof Array) {

    var requests = [];
    var worker = new StreamWorker(new AWS.SNS(), process.env.TOPIC_ARN, pusher, rc, Raven);
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i]));
    }
    Promise.all(requests).then(function(data) {
      console.log(JSON.stringify(data));
      callback(null, data);
    }).catch(function(err) {
      Raven.captureException(err, function (sendErr, eventId) {
        if (sendErr) {
          console.log('Failed to send captured exception to Sentry');
          console.log(JSON.stringify(sendErr));
          callback(sendErr);
          return;
        }
        callback(null, err);
      });
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
    callback(null, 'no action taken.');
  }
}