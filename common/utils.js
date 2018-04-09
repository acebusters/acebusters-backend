export const delay = (ms, arg) => new Promise(resolve => setTimeout(resolve, ms, arg));

export const not = fn => (...args) => !fn(...args);

export function now(secs = 0) {
  return Math.floor(Date.now() / 1000) + secs;
}

export function range(s, e) {
  return Array.from(new Array((e - s) + 1), (_, i) => i + s);
}

export function identity(a) {
  return a;
}

export function dbMethod(provider, name, params) {
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

// transform from key/value to list and back
export function transform(data) {
  let attributes;
  if (Array.isArray(data)) {
    attributes = {};
    data.forEach((aPair) => {
      if (!attributes[aPair.Name]) {
        attributes[aPair.Name] = {};
      }
      attributes[aPair.Name] = aPair.Value;
    });
  } else {
    attributes = [];
    Object.keys(data).forEach((anAttributeName) => {
      data[anAttributeName].forEach((aValue) => {
        attributes.push({
          Name: anAttributeName,
          Value: aValue,
          Replace: true,
        });
      });
    });
  }
  return attributes;
}
