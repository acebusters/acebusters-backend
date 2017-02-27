var expect = require('chai').expect;
var sinon = require('sinon');
require('chai').use(require('sinon-chai'));
const StreamWorker = require('./lib/index');

describe('Stream worker', function() {

  it('should notice lastHand change.', (done) => {


    const event = {
      eventName: "MODIFY",
      dynamodb: {
        NewImage: {
          lineup: { L: [
            { M: { address: { S: '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f' } } },
            { M: {
              address: {
                S: '0xc3ccb3902a164b83663947aff0284c6624f3fbf2'
              },
              lastHand: {
                N: '0'
              },
              leaveReceipt: {
                S: '0x1234'
              }
            }},
          ]}
        },
        OldImage: {
          lineup: { L: [
            { M: { address: { S: '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f' } } },
            { M: { address: { S: '0xc3ccb3902a164b83663947aff0284c6624f3fbf2' } } }
          ]}
        }
      }
    }

    new StreamWorker().process(event).then(function(receipt) {
      expect(receipt).to.eql('0x1234');
      done();
    }).catch(done);

  });

});