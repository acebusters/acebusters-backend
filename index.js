const StreamWorker = require('./lib/index');

exports.handler = function(event, context, callback) {

  if (event.Records && event.Records instanceof Array) {
    var requests = [];
    var worker = new StreamWorker();
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