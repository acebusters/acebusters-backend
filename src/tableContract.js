import Contract from './contract';

export default class TableContract extends Contract {

  constructor(
    abi,
    web3,
    senderAddr,
    sqs,
    queueUrl,
  ) {
    super(web3, senderAddr, sqs, queueUrl);
    this.abi = abi;
  }

  contract(tableAddr) {
    return this.web3.eth.contract(this.abi).at(tableAddr);
  }

  async leave(tableAddr, leaveReceipt) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'leave',
      200000,
      leaveReceipt,
    );
  }

  async toggleTable(tableAddr, activeReceipt) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'toggleActive',
      200000,
      [activeReceipt],
    );
  }

  async settle(tableAddr, sigs, newBalances) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'settle',
      500000,
      [sigs, `0x${newBalances.substring(2, 66)}`, `0x${newBalances.substring(66, 130)}`],
    );
  }

  async net(tableAddr) {
    return this.sendTransaction(this.contract(tableAddr), 'net', 2600000);
  }

  async submit(tableAddr, receipts) {
    const contract = this.contract(tableAddr);
    return this.call(contract.submit.call, receipts).then((writeCount) => {
      if (writeCount === 0) {
        throw new Error('Already submitted');
      }
      return this.sendTransaction(contract, 'submit', 1900000, [receipts]);
    });
  }

  getSmallBlind(tableAddr, secsFromStart) {
    const contract = this.contract(tableAddr);
    return this.call(contract.smallBlind.call, secsFromStart).then(val => val.toNumber());
  }

  async getLastHandNetted(tableAddr) {
    const contract = this.contract(tableAddr);
    return (
      this.call(contract.lastHandNetted.call)
        .then(val => val.toNumber(),
      ));
  }

  async getLineup(tableAddr) {
    const contract = this.contract(tableAddr);
    return this.call(contract.getLineup.call).then((data) => {
      if (!data || data.length < 4) {
        return Promise.reject('lineup response invalid.');
      }

      const rv = [];
      for (let i = 0; i < data[1].length; i += 1) {
        rv.push({
          address: data[1][i],
          amount: data[2][i],
          exitHand: data[3][i].toNumber(),
        });
      }

      return {
        lastHandNetted: data[0].toNumber(),
        lineup: rv,
      };
    });
  }
}
