const tableAbi = [{ inputs: [{ name: '_leaveReceipt', type: 'bytes' }], name: 'leave', outputs: [], type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'seats', outputs: [{ name: 'senderAddr', type: 'address' }, { name: 'amount', type: 'uint96' }, { name: 'signerAddr', type: 'address' }, { name: 'exitHand', type: 'uint96' }], type: 'function' }, { constant: true, inputs: [], name: 'lastNettingRequestTime', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { constant: true, inputs: [], name: 'lastHandNetted', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { inputs: [{ name: '_sender', type: 'address' }], name: 'payoutFrom', outputs: [], type: 'function' }, { inputs: [{ name: '_newBalances', type: 'bytes' }, { name: '_sigs', type: 'bytes' }], name: 'settle', outputs: [], type: 'function' }, { inputs: [], name: 'payout', outputs: [], type: 'function' }, { inputs: [{ name: '_now', type: 'uint256' }], name: 'netHelp', outputs: [], type: 'function' }, { constant: true, inputs: [], name: 'oracle', outputs: [{ name: '', type: 'address' }], type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'hands', outputs: [{ name: 'claimCount', type: 'uint256' }], type: 'function' }, { inputs: [{ name: '_buyIn', type: 'uint96' }, { name: '_signerAddr', type: 'address' }, { name: '_pos', type: 'uint256' }], name: 'join', outputs: [], type: 'function' }, { constant: true, inputs: [], name: 'getLineup', outputs: [{ name: '', type: 'uint256' }, { name: 'addresses', type: 'address[]' }, { name: 'amounts', type: 'uint256[]' }, { name: 'exitHands', type: 'uint96[]' }], type: 'function' }, { inputs: [{ name: '_bets', type: 'bytes' }, { name: '_sigs', type: 'bytes' }], name: 'submitBets', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { constant: true, inputs: [], name: 'lastNettingRequestHandId', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { inputs: [], name: 'net', outputs: [], type: 'function' }, { constant: true, inputs: [{ name: '', type: 'address' }], name: 'seatMap', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { constant: true, inputs: [{ name: '_handId', type: 'uint96' }, { name: '_addr', type: 'address' }], name: 'getIn', outputs: [{ name: '', type: 'uint96' }], type: 'function' }, { constant: true, inputs: [], name: 'smallBlind', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { constant: true, inputs: [{ name: '_handId', type: 'uint96' }, { name: '_addr', type: 'address' }], name: 'getOut', outputs: [{ name: '', type: 'uint96' }, { name: '', type: 'uint256' }], type: 'function' }, { inputs: [{ name: '_dists', type: 'bytes' }, { name: '_sigs', type: 'bytes' }], name: 'submitDists', outputs: [{ name: '', type: 'uint256' }], type: 'function' }, { constant: true, inputs: [], name: 'token', outputs: [{ name: '', type: 'address' }], type: 'function' }, { inputs: [{ name: '_token', type: 'address' }, { name: '_oracle', type: 'address' }, { name: '_smallBlind', type: 'uint256' }, { name: '_seats', type: 'uint256' }], type: 'constructor' }, { inputs: [{ indexed: false, name: 'addr', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }], name: 'Join', type: 'event' }, { inputs: [{ indexed: false, name: 'hand', type: 'uint256' }], name: 'NettingRequest', type: 'event' }, { inputs: [{ indexed: false, name: 'hand', type: 'uint256' }], name: 'Netted', type: 'event' }, { inputs: [{ indexed: false, name: 'addr', type: 'address' }], name: 'Leave', type: 'event' }, { inputs: [{ indexed: false, name: 'errorCode', type: 'uint256' }], name: 'Error', type: 'event' }];

function TableContract(web3) {
  this.web3 = web3;
}

TableContract.prototype.getLineup = function getLineup(tableAddr) {
  const contract = this.web3.eth.contract(tableAbi).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.getLineup.call((err, lineup) => {
      if (err) {
        reject(err);
        return;
      }
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
      fulfill({
        lastHandNetted: lineup[0],
        lineup: rv,
      });
    });
  });
};

module.exports = TableContract;
