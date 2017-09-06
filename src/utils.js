export function dbMethod(provider, name, params) { // eslint-disable-line
  return new Promise((resolve, reject) => {
    provider[name](params, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
