import contractMethod from './contractMethod';

function TableContract(web3) {
  this.web3 = web3;
}

TableContract.prototype.getLineup = contractMethod('getLineup', (lineup) => {
  const rv = [];
  for (let i = 0; i < lineup[1].length; i += 1) {
    rv.push({
      address: lineup[1][i],
      amount: lineup[2][i],
    });
    if (lineup[3][i] > 0) {
      rv[i].exitHand = lineup[3][i];
    }
  }
  return {
    lastHandNetted: lineup[0],
    lineup: rv,
  };
});

TableContract.prototype.lastNettingRequestHandId = contractMethod('lastNettingRequestHandId');

TableContract.prototype.lastNettingRequestTime = contractMethod('lastNettingRequestTime');

TableContract.prototype.getIn = contractMethod('getIn');

TableContract.prototype.getOut = contractMethod('getIn', result => ({
  claimCount: result[0],
  out: result[1],
}));

module.exports = TableContract;
