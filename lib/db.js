
function Db (dynamo) {
  this.dynamo = dynamo;
}

Db.prototype.getHand = function(tableAddr, handId) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var byId = self.dynamo.getItem({
      TableName: 'poker',
      Key: {
        id : tableAddr
      }
    }, function(err, data){
      if (err) {
        reject('Error: '+ err);
      }

      fulfill(data);
    });
  });
}

module.exports = Db;