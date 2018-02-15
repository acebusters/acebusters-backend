import Contract from './contract';

const TABLE_ABI = [{ constant: true, inputs: [], name: 'active', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_handId', type: 'uint256' }, { name: '_addr', type: 'address' }], name: 'getOut', outputs: [{ name: '', type: 'uint256' }, { name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'seats', outputs: [{ name: 'senderAddr', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'signerAddr', type: 'address' }, { name: 'exitHand', type: 'uint256' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_toggleReceipt', type: 'bytes' }], name: 'toggleActive', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_addr', type: 'address' }], name: 'inLineup', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_r', type: 'bytes32' }, { name: '_s', type: 'bytes32' }, { name: '_pl', type: 'bytes32' }], name: 'leave', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'lastNettingRequestTime', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'lastHandNetted', outputs: [{ name: '', type: 'uint32' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_sigs', type: 'bytes' }, { name: '_newBal1', type: 'bytes32' }, { name: '_newBal2', type: 'bytes32' }], name: 'settle', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'tokenAddr', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_now', type: 'uint256' }], name: 'netHelp', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'oracle', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_data', type: 'bytes32[]' }], name: 'submit', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'hands', outputs: [{ name: 'claimCount', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_handId', type: 'uint256' }, { name: '_addr', type: 'address' }], name: 'getIn', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'getLineup', outputs: [{ name: '', type: 'uint256' }, { name: 'addresses', type: 'address[]' }, { name: 'amounts', type: 'uint256[]' }, { name: 'exitHands', type: 'uint256[]' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'lastNettingRequestHandId', outputs: [{ name: '', type: 'uint32' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_from', type: 'address' }, { name: '_value', type: 'uint256' }, { name: '_data', type: 'bytes' }], name: 'tokenFallback', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [], name: 'net', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'smallBlind', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { inputs: [{ name: '_token', type: 'address' }, { name: '_oracle', type: 'address' }, { name: '_smallBlind', type: 'uint256' }, { name: '_seats', type: 'uint256' }], payable: false, type: 'constructor' }, { anonymous: false, inputs: [{ indexed: true, name: 'addr', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }], name: 'Join', type: 'event' }, { anonymous: false, inputs: [{ indexed: false, name: 'hand', type: 'uint256' }], name: 'NettingRequest', type: 'event' }, { anonymous: false, inputs: [{ indexed: false, name: 'hand', type: 'uint256' }], name: 'Netted', type: 'event' }, { anonymous: false, inputs: [{ indexed: false, name: 'addr', type: 'address' }], name: 'Leave', type: 'event' }];
const ABIs = {
  cashgame: TABLE_ABI,
  tournament: TABLE_ABI,
};

const ABI_TABLE_FACTORY = [{ constant: false, inputs: [{ name: '_newOwner', type: 'address' }], name: 'transfer', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'getTables', outputs: [{ name: '', type: 'address[]' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_addr', type: 'address' }], name: 'isOwner', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '', type: 'uint256' }], name: 'tables', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'owner', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_smallBlind', type: 'uint96' }, { name: '_seats', type: 'uint256' }], name: 'create', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'tokenAddress', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'oracleAddress', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_token', type: 'address' }, { name: '_oracle', type: 'address' }], name: 'configure', outputs: [], payable: false, type: 'function' }];

class TableFactory extends Contract {
  constructor(factoryAddr, web3) {
    super(web3);
    this.factoryAddr = factoryAddr;
  }

  async getTables() {
    const contract = this.web3.eth.contract(ABI_TABLE_FACTORY).at(this.factoryAddr);
    return this.call(contract.getTables.call);
  }
}

export default class TableContract extends Contract {
  constructor(factoryAddr, web3) {
    super(web3);
    this.factory = new TableFactory(factoryAddr, web3);
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
          exitHand: data[3][i],
        });
      }

      return {
        lastHandNetted: data[0],
        lineup: rv,
      };
    });
  }

  async getSmallBlind(tableAddr) {
    const contract = await this.contract(tableAddr);
    return this.call(contract.smallBlind.call).then(Number);
  }
}
