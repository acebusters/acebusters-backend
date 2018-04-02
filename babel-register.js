require('babel-register')({ // eslint-disable-line
  ignore: /node_modules\/(?!ab-backend-common)/,
});
require('babel-polyfill'); // eslint-disable-line
