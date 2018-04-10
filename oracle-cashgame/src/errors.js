
class ExtendableError extends Error {
  constructor(message, prefix) {
    super(message);
    this.message = `${prefix}: ${message}`;
  }
}

class Unauthorized extends ExtendableError {
  constructor(message) {
    super(message, 'Unauthorized');
  }
}

class Forbidden extends ExtendableError {
  constructor(message) {
    super(message, 'Forbidden');
  }
}

class BadRequest extends ExtendableError {
  constructor(message) {
    super(message, 'Bad Request');
  }
}

class NotFound extends ExtendableError {
  constructor(message) {
    super(message, 'Not Found');
  }
}

class Conflict extends ExtendableError {
  constructor(message) {
    super(message, 'Conflict');
  }
}

export { Unauthorized, NotFound, BadRequest, Forbidden, Conflict };
