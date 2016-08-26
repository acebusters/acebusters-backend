const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-1'});


exports.handler = function(event, context, callback) {

  console.log('Request received:\n', JSON.stringify(event));
  console.log('Context received:\n', JSON.stringify(context));
  
  var handleRequest,
    manager,
    path = event.context['resource-path'];
  if (path.indexOf('pay') > -1) {
    handleRequest = manager.pay();
  } else if (path.indexOf('deal') > -1) {
    handleRequest = manager.deal();
  } else if (path.indexOf('flop') > -1) {
    handleRequest = manager.flop();
  } else if (path.indexOf('turn') > -1) {
    handleRequest = manager.turn();
  } else if (path.indexOf('river') > -1) {
    handleRequest = manager.turn();
  } else if (path.indexOf('show') > -1) {
    handleRequest = manager.turn();
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