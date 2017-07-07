export const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export function getIns(contract, tableAddr, handId, lineup) {
  return Promise.all(lineup.map(({ address }) => {
    if (address === EMPTY_ADDR) {
      return Promise.resolve(null);
    }

    return contract.getIn(tableAddr, handId, address);
  }));
}

export function getOuts(contract, tableAddr, handId, lineup) {
  return Promise.all(lineup.map(({ address }) => {
    if (address === EMPTY_ADDR) {
      return Promise.resolve(null);
    }

    return contract.getOut(tableAddr, handId, address);
  }));
}
