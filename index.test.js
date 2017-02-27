var expect = require('chai').expect;
var sinon = require('sinon');
require('chai').use(require('sinon-chai'));
const StreamWorker = require('./lib/index');
const TableContract = require('./lib/tableContract');

var contract = {
  leave: {
    sendTransaction: function(){}, 
  },
}

var provider = {
  getTable: function(){},
  getAddress: function(){},
}

describe('Stream worker', function() {

  beforeEach(function () {
    sinon.stub(provider, 'getTable').returns(contract);
  });

  it('should notice lastHand change.', (done) => {

    const event = {
      eventName: "MODIFY",
      dynamodb: {
        Keys: {
          tableAddr: { S: "0xa2decf075b96c8e5858279b31f644501a140e8a7" }
        },
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
                S: '0x99'
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
    sinon.stub(contract.leave, 'sendTransaction').yields(null, '0x123456');
    sinon.stub(provider, 'getAddress').returns('0x7777');

    const worker = new StreamWorker(new TableContract(provider));    

    worker.process(event).then(function(receipt) {
      expect(receipt).to.eql('0x123456');
      expect(contract.leave.sendTransaction).calledWith('0x99', {from: '0x7777', gas: sinon.match.any}, sinon.match.any);
      done();
    }).catch(done);

  });

  afterEach(function () {
    if (contract.leave.sendTransaction.restore) contract.leave.sendTransaction.restore();
    if (provider.getTable.restore) provider.getTable.restore();
  });

});