import Contract from './contract';

const TABLE_ABI = [{"constant":true,"inputs":[],"name":"active","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"seats","outputs":[{"name":"senderAddr","type":"address"},{"name":"amount","type":"uint256"},{"name":"signerAddr","type":"address"},{"name":"exitHand","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"lastHandNetted","outputs":[{"name":"","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"tokenAddr","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"hands","outputs":[{"name":"claimCount","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"blindStructure","outputs":[{"name":"","type":"uint16"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestHandId","outputs":[{"name":"","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"blindLevelDuration","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_seats","type":"uint256"},{"name":"_disputeTime","type":"uint256"},{"name":"_blindStructure","type":"uint16[]"},{"name":"_blindLevelDuration","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"name":"addr","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Join","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"NettingRequest","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"Netted","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"}],"name":"Leave","type":"event"},{"constant":true,"inputs":[{"name":"secsFromStart","type":"uint256"}],"name":"blindLevel","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"secsFromStart","type":"uint256"}],"name":"smallBlind","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"getLineup","outputs":[{"name":"","type":"uint256"},{"name":"addresses","type":"address[]"},{"name":"amounts","type":"uint256[]"},{"name":"exitHands","type":"uint256[]"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getIn","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getOut","outputs":[{"name":"","type":"uint256"},{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_addr","type":"address"}],"name":"inLineup","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_toggleReceipt","type":"bytes"}],"name":"toggleActive","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_from","type":"address"},{"name":"_value","type":"uint256"},{"name":"_data","type":"bytes"}],"name":"tokenFallback","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_r","type":"bytes32"},{"name":"_s","type":"bytes32"},{"name":"_pl","type":"bytes32"}],"name":"leave","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_sigs","type":"bytes"},{"name":"_newBal1","type":"bytes32"},{"name":"_newBal2","type":"bytes32"}],"name":"settle","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_data","type":"bytes32[]"}],"name":"submit","outputs":[{"name":"writeCount","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"net","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"}]; // eslint-disable-line
const ABIs = {
  cashgame: TABLE_ABI,
  tournament: TABLE_ABI,
};

const ABI_TABLE_FACTORY = [{ constant: false, inputs: [{ name: '_newOwner', type: 'address' }], name: 'transfer', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'getTables', outputs: [{ name: '', type: 'address[]' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_addr', type: 'address' }], name: 'isOwner', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'tables', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'owner', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_smallBlind', type: 'uint96' }, { name: '_seats', type: 'uint256' }], name: 'create', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'tokenAddress', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'oracleAddress', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_token', type: 'address' }, { name: '_oracle', type: 'address' }], name: 'configure', outputs: [], payable: false, type: 'function' }];

class TableFactory extends Contract {
  constructor(
    factoryAddr,
    web3,
    senderAddr,
    sqs,
    queueUrl,
  ) {
    super(web3, senderAddr, sqs, queueUrl);
    this.factoryAddr = factoryAddr;
  }

  async getTables() {
    const contract = this.web3.eth.contract(ABI_TABLE_FACTORY).at(this.factoryAddr);
    return this.call(contract.getTables.call);
  }
}

export default class TableContract extends Contract {
  constructor(
    factoryAddr,
    web3,
    senderAddr,
    sqs,
    queueUrl,
  ) {
    super(web3, senderAddr, sqs, queueUrl);
    this.factory = new TableFactory(factoryAddr, web3, senderAddr, sqs, queueUrl);
    this.cashgameTables = null;
  }

  async tableType(tableAddr) {
    if (!this.cashgameTables) {
      this.cashgameTables = await this.factory.getTables();
    }

    return this.cashgameTables.indexOf(tableAddr) > -1 ? 'cashgame' : 'tournament';
  }

  async contract(tableAddr) {
    const type = await this.tableType(tableAddr);
    return this.web3.eth.contract(ABIs[type]).at(tableAddr);
  }

  async leave(tableAddr, leaveReceipt) {
    return this.sendTransaction(
      await this.contract(tableAddr),
      'leave',
      200000,
      leaveReceipt,
    );
  }

  async toggleTable(tableAddr, activeReceipt) {
    return this.sendTransaction(
      await this.contract(tableAddr),
      'toggleActive',
      200000,
      [activeReceipt],
    );
  }

  async settle(tableAddr, sigs, newBalances) {
    return this.sendTransaction(
      await this.contract(tableAddr),
      'settle',
      500000,
      [sigs, `0x${newBalances.substring(2, 66)}`, `0x${newBalances.substring(66, 130)}`],
    );
  }

  async net(tableAddr) {
    return this.sendTransaction(await this.contract(tableAddr), 'net', 2600000);
  }

  async submit(tableAddr, receipts) {
    const contract = await this.contract(tableAddr);
    return this.call(contract.submit.call, receipts).then((writeCount) => {
      if (writeCount === 0) {
        throw new Error('Already submitted');
      }
      return this.sendTransaction(contract, 'submit', 1900000, [receipts]);
    });
  }

  async getSmallBlind(tableAddr, secsFromStart) {
    const contract = await this.contract(tableAddr);
    return this.call(contract.smallBlind.call, secsFromStart).then(val => val.toNumber());
  }

  async getLastHandNetted(tableAddr) {
    const contract = await this.contract(tableAddr);
    return (
      this.call(contract.lastHandNetted.call)
        .then(val => val.toNumber(),
      ));
  }

  async getLineup(tableAddr) {
    const contract = await this.contract(tableAddr);
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
