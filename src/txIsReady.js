export default function txIsReady(web3, txHash) {
  return new Promise((resolve) => {
    web3.eth.getTransaction(txHash, (err, tx) => {
      if (err || !tx) {
        // if we have some troubles with tx
        // we need to release seat
        resolve(true);
      } else {
        web3.eth.getTransactionReceipt(txHash, (receiptErr, receipt) => {
          resolve(!err && receipt);
        });
      }
    });
  });
}
