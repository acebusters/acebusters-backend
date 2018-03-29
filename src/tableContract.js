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

  leave(tableAddr, leaveReceipt) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'leave',
      200000,
      leaveReceipt,
    );
  }

  toggleTable(tableAddr, activeReceipt) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'toggleActive',
      200000,
      [activeReceipt],
    );
  }

  settle(tableAddr, sigs, newBalances) {
    return this.sendTransaction(
      this.contract(tableAddr),
      'settle',
      500000,
      [sigs, `0x${newBalances.substring(2, 66)}`, `0x${newBalances.substring(66, 130)}`],
    );
  }

  getSmallBlind(tableAddr, secsFromStart) {
    const contract = this.contract(tableAddr);
    return this.call(contract.smallBlind.call, secsFromStart).then(Number);
  }

  getLastHandNetted(tableAddr) {
    const contract = this.contract(tableAddr);
    return this.call(contract.lastHandNetted.call).then(Number);
  }

  async getLineup(tableAddr) {
    const contract = this.contract(tableAddr);
    const data = await this.call(contract.getLineup.call);

    if (!data || data.length < 4) {
      throw 'lineup response invalid.'; // eslint-disable-line
    }

    return {
      lastHandNetted: Number(data[0]),
      lineup: data[1].map((address, i) => ({
        address,
        amount: data[2][i],
        exitHand: Number(data[3][i]),
      })),
    };
  }
}
